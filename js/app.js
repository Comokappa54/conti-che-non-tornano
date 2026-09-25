// Le schermate e i tre ruoli:
//   arbitro   — ha creato la stanza: gioca come gli altri, ma tiene le regole
//               e manda lo stato a tutti
//   giocatore — riceve lo stato, manda il suo numero
//   tavolo    — schermo comune (tv, portatile): guarda e basta

(function () {
  var $app = document.getElementById("app");
  var $rete = document.getElementById("rete");

  var io = null;        // { ruolo, codice, id, nome }
  var st = null;        // stato completo, solo sull'arbitro
  var pub = null;       // stato pubblico
  var priv = null;      // la mia domanda
  var ui = { schermata: "home", bozza: "", mandato: null, rimandi: 0, scelti: [], avviso: "",
             anim: {}, primoStato: true, firma: "", nonTrovata: false };
  var privMandate = {}; // per non rimandare domande private uguali

  var LETTERE = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  var ORE_12 = 12 * 3600 * 1000;

  // ------------------------------------------------------------ memoria
  function leggi(dove, k) { try { return JSON.parse(window[dove].getItem(k)); } catch (e) { return null; } }
  function scrivi(dove, k, v) { try { if (v == null) window[dove].removeItem(k); else window[dove].setItem(k, JSON.stringify(v)); } catch (e) {} }

  function nuovoId() { return Math.random().toString(36).slice(2, 12); }
  function nuovoCodice() { var s = ""; for (var i = 0; i < 4; i++) s += LETTERE[Math.floor(Math.random() * LETTERE.length)]; return s; }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }

  // ------------------------------------------------------------ schermo acceso
  var blocco = null;
  function tieniAcceso() {
    if (!("wakeLock" in navigator) || blocco) return;
    navigator.wakeLock.request("screen").then(function (b) {
      blocco = b; b.addEventListener("release", function () { blocco = null; });
    }).catch(function () {});
  }
  document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible" && io) tieniAcceso(); });

  Rete.suStato(function (s) { $rete.className = s; });

  // ============================================================ ARBITRO
  // Il mazzo lo scarica solo l'arbitro: sugli altri telefoni le domande non ci sono.
  function conMazzo(fatto) {
    if (window.MAZZO) return fatto();
    var s = document.createElement("script");
    s.src = "js/domande.js"; s.onload = fatto;
    s.onerror = function () { avvisa("Non riesco a caricare le domande. Ricarica la pagina."); };
    document.head.appendChild(s);
  }

  function avviaArbitro(nome, ripresa) {
    if (!window.MAZZO) return conMazzo(function () { avviaArbitro(nome, ripresa); });
    if (ripresa) {
      io = { ruolo: "arbitro", codice: ripresa.codice, id: ripresa.id, nome: ripresa.nome };
      st = ripresa.st;
    } else {
      io = { ruolo: "arbitro", codice: nuovoCodice(), id: nuovoId(), nome: nome };
      st = Regole.nuovaStanza(io.codice, Math.random);
      Regole.aggiungiGiocatore(st, io.id, nome);
    }
    scrivi("sessionStorage", "cctn_io", io);
    aggiornaLocale();
    Rete.connetti(function () {
      Rete.ascolta(io.codice, "azioni", suAzione);
      privMandate = {};
      pubblica();
    });
    setInterval(function () { if (Rete.collegato()) mandaStato(); }, 15000);
  }

  function suAzione(a) {
    if (!a || typeof a.id !== "string") return;
    var cambiato = false;
    if (a.t === "entra") cambiato = Regole.aggiungiGiocatore(st, a.id, a.nome).ok;
    else if (a.t === "numero") cambiato = Regole.scriviNumero(st, a.id, a.chiave, a.v, Math.random);
    else if (a.t === "esce") cambiato = Regole.togliGiocatore(st, a.id, Math.random);
    if (cambiato) dopoCambio();
  }

  function dopoCambio() {
    st.n = (st.n || 0) + 1;       // numero progressivo: chi riceve scarta i doppioni vecchi
    scrivi("localStorage", "cctn_arbitro", { codice: io.codice, id: io.id, nome: io.nome, st: st, quando: Date.now() });
    aggiornaLocale();
    pubblica();
  }

  function aggiornaLocale() {
    var v = Regole.vistaPubblica(st); v.arbitro = io.id; v.n = st.n || 0;
    suPrivata(Regole.vistaPrivata(st, io.id));
    suPubblico(v, true);
  }

  function mandaStato() {
    var v = Regole.vistaPubblica(st); v.arbitro = io.id; v.ts = Date.now(); v.n = st.n || 0;
    Rete.manda(io.codice, "stato", v, true);
  }

  function pubblica() {
    if (!Rete.collegato()) return;
    mandaStato();
    st.giocatori.forEach(function (g) {
      if (g.id === io.id) return;
      var p = JSON.stringify(Regole.vistaPrivata(st, g.id));
      if (privMandate[g.id] === p) return;
      privMandate[g.id] = p;
      var dati = JSON.parse(p); dati.n = st.n || 0;
      Rete.manda(io.codice, "p/" + g.id, dati, true);
    });
  }

  // ============================================================ GIOCATORE
  function avviaGiocatore(codice, nome, id) {
    io = { ruolo: "giocatore", codice: codice, id: id || nuovoId(), nome: nome };
    scrivi("sessionStorage", "cctn_io", io);
    scrivi("localStorage", "cctn_nome", nome);
    ui.schermata = "gioco"; render();
    Rete.connetti(function () {
      Rete.ascolta(codice, "stato", function (v) { suPubblico(v); });
      Rete.ascolta(codice, "p/" + io.id, suPrivata);
      bussa();
    });
    setTimeout(function () { if (!pub) { ui.nonTrovata = true; render(); } }, 9000);
    setInterval(bussa, 2500);
  }

  // Finché l'arbitro non ci ha registrato — o non ha ricevuto il numero — si insiste.
  function bussa() {
    if (!io || io.ruolo !== "giocatore" || !Rete.collegato()) return;
    var dentro = pub && pub.giocatori.some(function (g) { return g.id === io.id; });
    if (!dentro) Rete.manda(io.codice, "azioni", { t: "entra", id: io.id, nome: io.nome });
    var m = ui.mandato;
    if (dentro && m && pub.fase === "scrittura" && m.chiave === pub.chiave &&
        (pub.hanno.indexOf(io.id) < 0 || ui.rimandi < 2)) {
      ui.rimandi++;
      Rete.manda(io.codice, "azioni", { t: "numero", id: io.id, chiave: m.chiave, v: m.v });
    }
  }

  // ============================================================ TAVOLO
  function avviaTavolo(codice) {
    io = { ruolo: "tavolo", codice: codice, id: "tavolo", nome: "" };
    scrivi("sessionStorage", "cctn_io", io);
    document.body.classList.add("tavolo");
    ui.schermata = "gioco"; render();
    Rete.connetti(function () { Rete.ascolta(codice, "stato", function (v) { suPubblico(v); }); });
    setTimeout(function () { if (!pub) { ui.nonTrovata = true; render(); } }, 9000);
  }

  // ============================================================ STATO IN ARRIVO
  function suPubblico(v, locale) {
    if (!locale && pub && v.n < pub.n) return;      // doppione in ritardo dall'altro broker
    var prima = pub;
    pub = v; ui.nonTrovata = false;
    if (!locale) pub.visto = Date.now();
    // prima volta che vedo questa rivelazione: se la pagina è appena stata aperta
    // a rivelazione già fatta, niente conto alla rovescia
    if (pub.chiave && pub.fase !== "attesa" && pub.fase !== "scrittura" && !ui.anim[pub.chiave]) {
      ui.anim[pub.chiave] = ui.primoStato && !locale ? -1 : Date.now();
      if (ui.anim[pub.chiave] > 0) avviaAnimazione();
    }
    ui.primoStato = false;
    if (!prima || prima.chiave !== pub.chiave) {
      // round nuovo: lavagnetta pulita, a meno che questa scheda non abbia già
      // scritto in questo round prima di ricaricare la pagina
      var m = leggi("sessionStorage", "cctn_mandato");
      ui.mandato = m && m.codice === io.codice && m.chiave === pub.chiave ? m : null;
      ui.bozza = ""; ui.rimandi = 0; ui.scelti = [];
    }
    if (pub.fase !== "rivelazione") ui.scelti = [];
    ui.schermata = "gioco";
    render();
  }

  function suPrivata(p) {
    if (priv && p.n < priv.n) return;
    priv = p; render();
  }

  // ============================================================ AZIONI DAL TELEFONO
  function mioNumero(v) {
    ui.mandato = { codice: io.codice, chiave: pub.chiave, v: v }; ui.rimandi = 0;
    scrivi("sessionStorage", "cctn_mandato", ui.mandato);
    if (io.ruolo === "arbitro") {
      if (Regole.scriviNumero(st, io.id, pub.chiave, v, Math.random)) dopoCambio();
    } else {
      Rete.manda(io.codice, "azioni", { t: "numero", id: io.id, chiave: pub.chiave, v: v });
    }
    render();
  }

  var comandiArbitro = {
    inizia: function () { return Regole.iniziaPartita(st, Math.random); },
    forza: function () {
      var r = Regole.rivela(st, true, Math.random);
      if (r === "rifatto") avvisa("Round annullato: si rigioca con un'altra domanda.");
      return !!r;
    },
    accusa: function () { return Regole.accusa(st, ui.scelti); },
    prossimo: function () { return Regole.prossimo(st, Math.random); },
    togli: function (id) { return Regole.togliGiocatore(st, id, Math.random); },
    piccanti: function () { return Regole.impostaPiccanti(st, !st.senzaPiccanti); }
  };

  function avvisa(t) { ui.avviso = t; render(); setTimeout(function () { ui.avviso = ""; render(); }, 3500); }

  function invita() {
    var url = location.origin + location.pathname + "?s=" + io.codice;
    if (navigator.share) navigator.share({ title: "Conti che non tornano", text: "Entra nella stanza " + io.codice, url: url }).catch(function () {});
    else if (navigator.clipboard) navigator.clipboard.writeText(url).then(function () { avvisa("Link copiato"); });
  }

  function esci() {
    if (io && io.ruolo === "giocatore") Rete.manda(io.codice, "azioni", { t: "esce", id: io.id });
    if (io && io.ruolo === "arbitro" && !confirm("Chiudi la stanza? La partita finisce per tutti.")) return;
    if (io && io.ruolo === "arbitro") { scrivi("localStorage", "cctn_arbitro", null); Rete.manda(io.codice, "stato", null, true); }
    scrivi("sessionStorage", "cctn_io", null);
    setTimeout(function () { location.href = location.pathname; }, 300);
  }

  // ============================================================ DISEGNO
  function giocatore(id) {
    if (!pub) return null;
    for (var i = 0; i < pub.giocatori.length; i++) if (pub.giocatori[i].id === id) return pub.giocatori[i];
    return null;
  }
  function nomeArbitro() { var g = giocatore(pub.arbitro); return g ? g.nome : "chi ha creato la stanza"; }
  // l'arbitro rimanda lo stato ogni 15 secondi: se tace da 45, qualcosa non va
  function arbitroFermo() { return io.ruolo !== "arbitro" && pub && pub.visto && Date.now() - pub.visto > 45000; }
  function sonoArbitro() { return io && io.ruolo === "arbitro"; }
  function partecipo() { return pub.partecipanti && pub.partecipanti.indexOf(io.id) >= 0; }
  function suffisso(u) { return u === "%" ? "%" : ""; }
  function scala(u) { return u === "%" ? "da 0 a 100" : u === "10" ? "da 1 a 10" : "un numero"; }

  function chip(g, extra) {
    return '<span class="chip" style="--c:' + g.colore + '">' + esc(g.nome) + (extra || "") + "</span>";
  }

  function render() {
    var firma = JSON.stringify([ui.schermata, io, pub && Object.assign({}, pub, { ts: 0, visto: 0 }),
                                priv, ui.mandato, ui.scelti, ui.avviso, ui.nonTrovata, io && arbitroFermo()]);
    if (firma === ui.firma) return;
    ui.firma = firma;
    var h;
    if (ui.schermata === "home") h = schermoHome();
    else if (ui.schermata === "crea" || ui.schermata === "entra" || ui.schermata === "tavolo") h = schermoModulo();
    else h = schermoGioco();
    $app.innerHTML = h + (ui.avviso ? '<div class="avviso">' + esc(ui.avviso) + "</div>" : "");
    passoAnimazione();
    var campo = $app.querySelector("input");
    if (campo && !("ontouchstart" in window)) campo.focus();
  }

  // ------------------------------------------------------------ home
  function schermoHome() {
    var r = leggi("localStorage", "cctn_arbitro");
    var riprendi = r && Date.now() - r.quando < ORE_12
      ? '<button class="btn chiaro" data-az="riprendi">Riprendi la stanza <b>' + esc(r.codice) + "</b></button>" : "";
    return '<section class="home">' +
      '<div class="logo"><span class="riga1">Conti</span><span class="riga2">che non</span><span class="riga3">tornano</span></div>' +
      '<div class="lavagne-deco"><div class="lav piccola" style="--c:#E4572E"><b>3</b></div>' +
      '<div class="lav piccola" style="--c:#2A9D8F"><b>2</b></div><div class="lav piccola storta" style="--c:#F2A541"><b>40</b></div>' +
      '<div class="lav piccola" style="--c:#7B5EA7"><b>3</b></div></div>' +
      '<p class="motto">Tutti rispondono alla stessa domanda.<br><em>Quasi</em> tutti.</p>' +
      '<div class="bottoni">' +
      '<button class="btn" data-az="vai" data-a="crea">Crea una stanza</button>' +
      '<button class="btn chiaro" data-az="vai" data-a="entra">Entra in una stanza</button>' + riprendi +
      '<button class="link" data-az="vai" data-a="tavolo">Usa questo schermo come tavolo</button>' +
      "</div></section>";
  }

  function schermoModulo() {
    var s = ui.schermata, qs = new URLSearchParams(location.search);
    var codice = (qs.get("s") || "").toUpperCase().slice(0, 4);
    var nome = leggi("localStorage", "cctn_nome") || "";
    var titolo = { crea: "Nuova stanza", entra: "Entra nella stanza", tavolo: "Schermo del tavolo" }[s];
    var campi = "";
    if (s !== "crea") campi += '<label>Codice della stanza<input id="f-codice" class="codice" maxlength="4" autocomplete="off" autocapitalize="characters" value="' + esc(codice) + '" placeholder="ABCD"></label>';
    if (s !== "tavolo") campi += '<label>Il tuo nome<input id="f-nome" maxlength="14" autocomplete="off" value="' + esc(nome) + '" placeholder="Come ti chiamano"></label>';
    var nota = s === "tavolo" ? '<p class="nota">Questo schermo mostra le lavagnette e la classifica a tutti. Non gioca.</p>' : "";
    return '<section class="modulo"><button class="link indietro" data-az="vai" data-a="home">← indietro</button>' +
      "<h2>" + titolo + "</h2>" + campi + nota +
      '<button class="btn" data-az="conferma">' + (s === "crea" ? "Crea" : s === "entra" ? "Entra" : "Guarda") + "</button>" +
      "</section>";
  }

  // ------------------------------------------------------------ partita
  function schermoGioco() {
    if (!pub) {
      return '<section class="attesa-rete"><div class="lav grande girando"><b>…</b></div><p>' +
        (ui.nonTrovata ? "La stanza <b>" + esc(io.codice) + "</b> non risponde.<br>Controlla il codice, o che il telefono di chi l'ha creata sia acceso." : "Mi collego alla stanza <b>" + esc(io.codice) + "</b>…") +
        '</p><button class="link" data-az="esci">← torna all\'inizio</button></section>';
    }
    var corpo = { attesa: fAttesa, scrittura: fScrittura, rivelazione: fRivelazione, verdetto: fVerdetto, fine: fFine }[pub.fase]();
    var guasto = arbitroFermo()
      ? '<div class="guasto">Il telefono di ' + esc(nomeArbitro()) + " non risponde. Deve restare acceso, con questa pagina aperta.</div>" : "";
    return guasto + testata() + corpo +
      '<footer><button class="link" data-az="esci">' + (sonoArbitro() ? "chiudi la stanza" : "esci") + "</button></footer>";
  }

  function testata() {
    var me = giocatore(io.id);
    var sx = pub.fase === "attesa" ? "<span>Stanza</span>" :
      pub.fase === "fine" ? "<span>Partita finita</span>" :
      "<span>Round <b>" + pub.round + "</b>/" + pub.totRound + "</span>";
    return '<header class="testata">' + sx + '<span class="cod">' + esc(pub.codice) + "</span>" +
      (me ? chip(me, ' <i class="punti">' + me.punti + "</i>") : "") + "</header>";
  }

  function fAttesa() {
    var n = pub.giocatori.length;
    var lista = pub.giocatori.map(function (g) {
      var x = sonoArbitro() && g.id !== io.id ? ' <button class="x" data-az="togli" data-a="' + g.id + '" aria-label="togli">×</button>' : "";
      return chip(g, g.id === pub.arbitro ? ' <i class="corona">★</i>' + x : x);
    }).join("");
    var giu = sonoArbitro()
      ? '<button class="btn" data-az="arb" data-a="inizia"' + (n < 3 ? " disabled" : "") + ">Inizia la partita</button>" +
        '<p class="nota">' + (n < 3 ? "Servono almeno 3 giocatori." : n + " giocatori · " + impostori(Regole.nImpostori(n))) + "</p>"
      : io.ruolo === "tavolo" ? '<p class="nota">Si parte quando ' + esc(nomeArbitro()) + " lo decide.</p>"
      : '<p class="nota">Quando ci siete tutti, ' + esc(nomeArbitro()) + " fa partire la partita.</p>";
    return '<section class="attesa">' +
      '<p class="eti">Codice della stanza</p><div class="codice-grande">' + esc(pub.codice).split("").map(function (c) { return "<span>" + c + "</span>"; }).join("") + "</div>" +
      (sonoArbitro() ? '<button class="btn chiaro piccolo" data-az="invita">Invita gli altri</button>' : "") +
      '<div class="gente">' + (lista || '<span class="nota">Ancora nessuno.</span>') + "</div>" + giu + piccanti() + "</section>";
  }

  // L'interruttore delle piccanti: lo tocca solo l'arbitro, fra una partita e l'altra.
  // Gli altri vedono solo un cartellino se sono tolte.
  function piccanti() {
    if (sonoArbitro()) {
      return '<button class="interruttore' + (pub.senzaPiccanti ? "" : " acceso") + '" data-az="arb" data-a="piccanti">' +
        '<span class="leva"></span><span>Domande piccanti <b>' + (pub.senzaPiccanti ? "tolte" : "incluse") + "</b></span></button>" +
        (pub.senzaPiccanti ? '<p class="nota piccola">Niente alcol, ex, baci e scommesse. Vale per tutta la sessione.</p>' : "");
    }
    return pub.senzaPiccanti ? '<p class="cartellino">Senza domande piccanti</p>' : "";
  }

  function impostori(k) { return k === 1 ? "1 impostore" : k + " impostori"; }

  function fScrittura() {
    var mancano = pub.partecipanti.filter(function (id) { return pub.hanno.indexOf(id) < 0; }).map(giocatore).filter(Boolean);
    var lavagne = '<div class="lavagne coperte">' + pub.partecipanti.map(function (id) {
      var g = giocatore(id); if (!g) return "";
      var pronto = pub.hanno.indexOf(id) >= 0;
      return '<div class="lav coperta' + (pronto ? " pronta" : "") + '" style="--c:' + g.colore + '"><b>' + (pronto ? "✓" : "") + "</b><span>" + esc(g.nome) + "</span></div>";
    }).join("") + "</div>";

    if (io.ruolo === "tavolo") {
      return '<section class="scrittura tavolo-scrive"><h2>Ognuno ha la sua domanda.<br>Scrivete il numero.</h2>' + lavagne + "</section>";
    }
    if (!partecipo()) {
      return '<section class="scrittura"><div class="carta"><p>Sei entrato a round iniziato: giochi dal prossimo.</p></div>' + lavagne + "</section>";
    }
    if (!priv || priv.chiave !== pub.chiave) {
      return '<section class="scrittura"><div class="carta domanda"><p class="eti">La tua domanda</p><p class="testo">Sta arrivando…</p></div></section>';
    }
    var forza = sonoArbitro() && mancano.length && pub.hanno.length >= 2
      ? '<button class="link" data-az="arb" data-a="forza">Rivela senza ' + mancano.map(function (g) { return esc(g.nome); }).join(", ") + "</button>" : "";

    if (ui.mandato && ui.mandato.chiave === pub.chiave) {
      var chi = mancano.length ? "Aspettiamo " + mancano.map(function (g) { return chip(g); }).join(" ") : "Ci siete tutti…";
      return '<section class="scrittura"><div class="carta domanda"><p class="eti">La tua domanda</p><p class="testo">' + esc(priv.testo) + "</p></div>" +
        '<div class="lav grande scritta" style="--c:' + giocatore(io.id).colore + '"><b>' + ui.mandato.v + suffisso(pub.unita) + "</b></div>" +
        '<p class="aspetta">' + chi + "</p>" +
        '<button class="btn chiaro piccolo" data-az="cambia">Cambia numero</button>' + forza + "</section>";
    }
    var tasti = [1, 2, 3, 4, 5, 6, 7, 8, 9, "⌫", 0, "✓"].map(function (t) {
      var cls = t === "✓" ? " ok" : t === "⌫" ? " canc" : "";
      return '<button class="tasto' + cls + '" data-az="tasto" data-a="' + t + '">' + t + "</button>";
    }).join("");
    return '<section class="scrittura"><div class="carta domanda"><p class="eti">La tua domanda</p><p class="testo">' + esc(priv.testo) + "</p>" +
      '<p class="scala">' + scala(pub.unita) + "</p></div>" +
      '<div class="lav grande" id="bozza" style="--c:' + giocatore(io.id).colore + '"><b>' + (ui.bozza ? ui.bozza + suffisso(pub.unita) : "?") + "</b></div>" +
      '<div class="tastiera">' + tasti + "</div>" + forza + "</section>";
  }

  // Le lavagnette girate, con il nome sotto. Usate in rivelazione e verdetto.
  function lavagneScoperte(evidenzia) {
    return '<div class="lavagne">' + pub.partecipanti.map(function (id, i) {
      var g = giocatore(id); if (!g) return "";
      var cls = evidenzia && evidenzia.indexOf(id) >= 0 ? " colpevole" : "";
      var acc = pub.accusati && pub.accusati.indexOf(id) >= 0 ? '<i class="dito">accusato</i>' : "";
      return '<div class="lav girevole' + cls + '" data-lav="' + i + '" style="--c:' + g.colore + '">' +
        '<div class="faccia dietro"></div><div class="faccia davanti"><b>' + pub.numeri[id] + suffisso(pub.unita) + "</b></div>" +
        "<span>" + esc(g.nome) + "</span>" + acc + "</div>";
    }).join("") + "</div>";
  }

  function fRivelazione() {
    var k = pub.nImpostori;
    var giu;
    if (sonoArbitro()) {
      var scelte = pub.partecipanti.map(function (id) {
        var g = giocatore(id); if (!g) return "";
        var on = ui.scelti.indexOf(id) >= 0;
        return '<button class="scelta' + (on ? " on" : "") + '" style="--c:' + g.colore + '" data-az="scegli" data-a="' + id + '">' + esc(g.nome) + "</button>";
      }).join("");
      giu = '<div class="voto"><p class="eti">Avete deciso? Segna ' + (k === 1 ? "chi accusate" : "fino a " + k + " accusati") + "</p>" +
        '<div class="scelte">' + scelte + "</div>" +
        '<button class="btn" data-az="arb" data-a="accusa"' + (ui.scelti.length ? "" : " disabled") + ">Accusa</button></div>";
    } else {
      giu = '<p class="nota">Discutete a voce. Quando avete deciso, ' + esc(nomeArbitro()) + " segna l'accusa.</p>";
    }
    return '<section class="rivelazione"><div class="conto" id="conto"></div>' + lavagneScoperte() +
      '<div class="carta vera nascosta" id="vera"><p class="eti">La domanda era</p><p class="testo">' + esc(pub.vera) + "</p>" +
      '<p class="sotto">Qualcuno ne ha letta un\'altra. ' + (k === 1 ? "Chi?" : "Sono in " + k + ".") + "</p></div>" +
      '<div class="dopo nascosta" id="dopo">' + giu + "</div></section>";
  }

  function fVerdetto() {
    var imp = pub.impostori.map(giocatore).filter(Boolean);
    var presi = pub.impostori.filter(function (id) { return pub.accusati.indexOf(id) >= 0; }).length;
    var titolo = presi === imp.length ? (imp.length === 1 ? "Preso!" : "Presi tutti!")
      : presi === 0 ? "Fatta franca!" : "Uno preso, uno no!";
    var chi = imp.map(function (g) { return chip(g); }).join(" e ");
    var tutti = pub.giocatori.slice().sort(function (a, b) { return b.punti - a.punti; });
    var classifica = '<ol class="classifica">' + tutti.map(function (g) {
      var d = pub.delta && pub.delta[g.id] ? '<i class="piu">+' + pub.delta[g.id] + "</i>" : "";
      return '<li style="--c:' + g.colore + '"><span>' + esc(g.nome) + "</span>" + d + "<b>" + g.punti + "</b></li>";
    }).join("") + "</ol>";
    var giu = sonoArbitro()
      ? '<button class="btn" data-az="arb" data-a="prossimo">' + (pub.round >= pub.totRound ? "Classifica finale" : "Prossimo round") + "</button>"
      : '<p class="nota">' + esc(nomeArbitro()) + " fa partire il prossimo round.</p>";
    return '<section class="verdetto"><h2 class="' + (presi ? "preso" : "franca") + '">' + titolo + "</h2>" +
      '<p class="rivela">' + (imp.length === 1 ? "L'impostore era " : "Gli impostori erano ") + chi + "</p>" +
      '<div class="carta falsa"><p class="eti">' + (imp.length === 1 ? "Aveva letto" : "Avevano letto") + '</p><p class="testo">' + esc(pub.falsa) + "</p></div>" +
      lavagneScoperte(pub.impostori) +
      '<div class="carta vera piccola"><p class="eti">Gli altri avevano</p><p class="testo">' + esc(pub.vera) + "</p></div>" +
      classifica + giu + "</section>";
  }

  function fFine() {
    var tutti = pub.giocatori.slice().sort(function (a, b) { return b.punti - a.punti; });
    var max = tutti.length ? tutti[0].punti : 0;
    var vincitori = tutti.filter(function (g) { return g.punti === max; });
    var podio = '<ol class="classifica finale">' + tutti.map(function (g) {
      return '<li style="--c:' + g.colore + '"' + (g.punti === max ? ' class="primo"' : "") + "><span>" + esc(g.nome) + "</span><b>" + g.punti + "</b></li>";
    }).join("") + "</ol>";
    var giu = sonoArbitro()
      ? '<button class="btn" data-az="arb" data-a="inizia">Nuova partita</button><p class="nota">Stessi giocatori, domande nuove.</p>'
      : '<p class="nota">Se volete rigiocare, ' + esc(nomeArbitro()) + " fa partire una nuova partita.</p>";
    return '<section class="fine"><p class="eti">Partita ' + pub.partita + " finita</p>" +
      "<h2>" + (vincitori.length === 1 ? "Vince " + esc(vincitori[0].nome) : "Pari tra " + vincitori.map(function (g) { return esc(g.nome); }).join(" e ")) + "</h2>" +
      podio + giu + piccanti() + "</section>";
  }

  // ------------------------------------------------------------ l'animazione della rivelazione
  // 3, 2, 1 → le lavagnette si girano una alla volta → compare la domanda vera
  var CONTO = 700, GIRO = 280;
  var timerAnim = null;
  function tempi(ch) {
    var t0 = ui.anim[ch];
    if (!t0 || t0 < 0) return { conto: 0, girate: 99, vera: true };
    var t = Date.now() - t0, n = pub.partecipanti.length;
    var fineConto = 3 * CONTO, fineGiro = fineConto + n * GIRO + 500;
    return {
      conto: t < fineConto ? 3 - Math.floor(t / CONTO) : 0,
      girate: t < fineConto ? 0 : Math.floor((t - fineConto) / GIRO) + 1,
      vera: t >= fineGiro, finita: t >= fineGiro + 200
    };
  }
  function passoAnimazione() {
    if (!pub || !pub.chiave || (pub.fase !== "rivelazione" && pub.fase !== "verdetto")) return;
    var s = tempi(pub.chiave);
    var $c = document.getElementById("conto");
    if ($c) { $c.textContent = s.conto || ""; $c.classList.toggle("vivo", !!s.conto); }
    $app.querySelectorAll("[data-lav]").forEach(function (el) {
      el.classList.toggle("girata", +el.getAttribute("data-lav") < s.girate);
    });
    ["vera", "dopo"].forEach(function (id) { var e = document.getElementById(id); if (e) e.classList.toggle("nascosta", !s.vera); });
    return s;
  }
  function avviaAnimazione() {
    clearInterval(timerAnim);
    if (navigator.vibrate) navigator.vibrate(20);
    timerAnim = setInterval(function () {
      var s = passoAnimazione();
      if (!s || s.finita) clearInterval(timerAnim);
    }, 60);
  }

  // ------------------------------------------------------------ tocchi
  $app.addEventListener("click", function (e) {
    var b = e.target.closest("[data-az]");
    if (!b || b.disabled) return;
    var az = b.getAttribute("data-az"), a = b.getAttribute("data-a");
    tieniAcceso();
    if (az === "vai") { ui.schermata = a; render(); }
    else if (az === "conferma") conferma();
    else if (az === "riprendi") { var r = leggi("localStorage", "cctn_arbitro"); if (r) avviaArbitro(r.nome, r); }
    else if (az === "invita") invita();
    else if (az === "esci") esci();
    else if (az === "tasto") tasto(a);
    else if (az === "cambia") { ui.bozza = ""; ui.mandato = null; scrivi("sessionStorage", "cctn_mandato", null); render(); }
    else if (az === "scegli") {
      var i = ui.scelti.indexOf(a);
      if (i >= 0) ui.scelti.splice(i, 1);
      else { if (ui.scelti.length >= pub.nImpostori) ui.scelti.shift(); ui.scelti.push(a); }
      render();
    }
    else if (az === "togli") { var g = giocatore(a); if (g && confirm("Togli " + g.nome + " dalla stanza?")) { if (comandiArbitro.togli(a)) dopoCambio(); } }
    else if (az === "arb") { if (comandiArbitro[a]()) dopoCambio(); }
  });

  $app.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && e.target.tagName === "INPUT") conferma();
  });
  document.addEventListener("keydown", function (e) {
    if (e.target.tagName === "INPUT" || !document.getElementById("bozza")) return;
    if (/^[0-9]$/.test(e.key)) tasto(e.key);
    else if (e.key === "Backspace") tasto("⌫");
    else if (e.key === "Enter") tasto("✓");
  });

  function tasto(t) {
    var u = pub.unita, max = u === "%" ? 100 : u === "10" ? 10 : 999999;
    if (t === "⌫") ui.bozza = ui.bozza.slice(0, -1);
    else if (t === "✓") {
      if (ui.bozza === "") return scuoti();
      var v = +ui.bozza;
      if (!Regole.valido(u, v)) return scuoti();
      return mioNumero(v);
    } else {
      var nuovo = (ui.bozza === "0" ? "" : ui.bozza) + t;
      if (+nuovo > max) return scuoti();
      ui.bozza = nuovo;
    }
    var $b = document.querySelector("#bozza b");
    if ($b) $b.textContent = ui.bozza ? ui.bozza + suffisso(u) : "?";
  }

  function scuoti() {
    var $b = document.getElementById("bozza");
    if (!$b) return;
    $b.classList.remove("scossa"); void $b.offsetWidth; $b.classList.add("scossa");
  }

  function conferma() {
    var s = ui.schermata;
    var $n = document.getElementById("f-nome"), $c = document.getElementById("f-codice");
    var nome = $n ? $n.value.replace(/\s+/g, " ").trim() : "";
    var codice = $c ? $c.value.toUpperCase().replace(/[^A-Z]/g, "") : "";
    if (s !== "tavolo" && !nome) { $n.focus(); $n.classList.add("errore"); return; }
    if (s !== "crea" && codice.length !== 4) { $c.focus(); $c.classList.add("errore"); return; }
    if (s !== "tavolo") scrivi("localStorage", "cctn_nome", nome);
    history.replaceState(null, "", location.pathname + (s === "crea" ? "" : "?s=" + codice));
    if (s === "crea") avviaArbitro(nome);
    else if (s === "entra") avviaGiocatore(codice, nome);
    else avviaTavolo(codice);
  }

  // ------------------------------------------------------------ avvio
  // Un ricaricamento della pagina riprende il ruolo che si aveva in questa scheda.
  (function avvio() {
    var mio = leggi("sessionStorage", "cctn_io");
    if (mio && mio.ruolo === "arbitro") {
      var r = leggi("localStorage", "cctn_arbitro");
      if (r && r.codice === mio.codice) return avviaArbitro(r.nome, r);
    }
    if (mio && mio.ruolo === "giocatore") return avviaGiocatore(mio.codice, mio.nome, mio.id);
    if (mio && mio.ruolo === "tavolo") return avviaTavolo(mio.codice);
    if (new URLSearchParams(location.search).get("s")) ui.schermata = "entra";
    render();
  })();

  // ogni tanto si ricontrolla se l'arbitro tace (la firma evita ridisegni inutili)
  setInterval(function () { if (pub && io) render(); }, 5000);
})();
