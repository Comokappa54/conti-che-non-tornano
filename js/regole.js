// Le regole del gioco. Gira solo sul telefono di chi ha creato la stanza,
// che è l'arbitro: gli altri mandano azioni e ricevono lo stato.
// Niente schermo qui dentro, così si collauda anche a vuoto (collaudo.js).

var Regole = (function () {

  var COLORI = ["#E4572E", "#2A9D8F", "#F2A541", "#7B5EA7", "#3A86FF",
                "#E07AAB", "#5DA93B", "#B5543A", "#1B7F91", "#C9A227",
                "#8C5E3C", "#D1495B"];
  var ROUND_PER_PARTITA = 10;
  var MAX_GIOCATORI = 12;

  // Punteggio provvisorio, da decidere insieme:
  var PUNTI_INNOCENTE_PER_IMPOSTORE_PRESO = 1;
  var PUNTI_IMPOSTORE_SCAPPATO = 3;

  function mescola(a, rnd) {
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(rnd() * (i + 1)), t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  function indici(n) { var a = []; for (var i = 0; i < n; i++) a.push(i); return a; }
  function dentro(a, x) { return a.indexOf(x) >= 0; }

  function nImpostori(n) { return Math.max(1, Math.floor(n / 4)); }

  function nuovaStanza(codice, rnd) {
    return {
      codice: codice, fase: "attesa", partita: 0, round: 0,
      totRound: ROUND_PER_PARTITA, giocatori: [],
      mazzo: mescola(indici(MAZZO.length), rnd), prossima: 0,
      corrente: null, ultimo: null
    };
  }

  function giocatore(st, id) {
    for (var i = 0; i < st.giocatori.length; i++) if (st.giocatori[i].id === id) return st.giocatori[i];
    return null;
  }

  // Una chiave per ogni domanda distribuita, anche quando un round si rigioca:
  // un numero scritto per la domanda vecchia non deve valere per quella nuova.
  function chiave(st) { st.serie = (st.serie || 0) + 1; return st.partita + "-" + st.round + "-" + st.serie; }

  // Chi rientra con lo stesso nome riprende il suo posto: è quasi sempre
  // lo stesso telefono che ha ricaricato la pagina.
  function aggiungiGiocatore(st, id, nome) {
    nome = String(nome || "").replace(/\s+/g, " ").trim().slice(0, 14);
    if (!nome) return { ok: false };
    if (giocatore(st, id)) return { ok: true };
    for (var i = 0; i < st.giocatori.length; i++) {
      var g = st.giocatori[i];
      if (g.nome.toLowerCase() === nome.toLowerCase()) {
        sostituisciId(st, g.id, id);
        return { ok: true, ripreso: true };
      }
    }
    if (st.giocatori.length >= MAX_GIOCATORI) return { ok: false };
    var usati = st.giocatori.map(function (g) { return g.colore; });
    var colore = COLORI.filter(function (c) { return !dentro(usati, c); })[0] || COLORI[0];
    st.giocatori.push({ id: id, nome: nome, colore: colore, punti: 0 });
    return { ok: true, nuovo: true };
  }

  function sostituisciId(st, vecchio, nuovo) {
    giocatore(st, vecchio).id = nuovo;
    var c = st.corrente;
    if (!c) return;
    function cambia(a) { var k = a.indexOf(vecchio); if (k >= 0) a[k] = nuovo; }
    cambia(c.partecipanti); cambia(c.impostori);
    if (c.accusati) cambia(c.accusati);
    if (vecchio in c.numeri) { c.numeri[nuovo] = c.numeri[vecchio]; delete c.numeri[vecchio]; }
  }

  function ammessa(st, i) { return !(st.senzaPiccanti && MAZZO[i][4] === "+"); }

  // Le piccanti, se tolte, si saltano senza bruciarle: la prima ammessa viene
  // scambiata al posto giusto, e le altre restano nel mazzo per dopo.
  function pescaDomanda(st, rnd) {
    for (var giro = 0; giro < 2; giro++) {
      for (var j = st.prossima; j < st.mazzo.length; j++) {
        if (!ammessa(st, st.mazzo[j])) continue;
        var t = st.mazzo[j]; st.mazzo[j] = st.mazzo[st.prossima]; st.mazzo[st.prossima] = t;
        return st.mazzo[st.prossima++];
      }
      st.mazzo = mescola(indici(MAZZO.length), rnd); st.prossima = 0;   // mazzo finito: si rimescola
    }
    return st.mazzo[st.prossima++];
  }

  // Solo fra una partita e l'altra (o prima di cominciare).
  function impostaPiccanti(st, togli) {
    if (st.fase !== "attesa" && st.fase !== "fine") return false;
    st.senzaPiccanti = !!togli;
    return true;
  }

  // rifai = stesso numero di round, domanda nuova (se l'impostore è sparito)
  function nuovoRound(st, rnd, rifai) {
    if (!rifai) st.round++;
    var partecipanti = st.giocatori.map(function (g) { return g.id; });
    var idx = pescaDomanda(st, rnd), q = MAZZO[idx];
    var scambia = rnd() < 0.5;
    var vera = scambia ? q[1] : q[0], falsa = scambia ? q[0] : q[1];
    var soggetto = null;
    if (vera.indexOf("{G}") >= 0 || falsa.indexOf("{G}") >= 0) {
      soggetto = st.giocatori[Math.floor(rnd() * st.giocatori.length)].nome;
      vera = vera.split("{G}").join(soggetto);
      falsa = falsa.split("{G}").join(soggetto);
    }
    var impostori = mescola(partecipanti.slice(), rnd).slice(0, nImpostori(partecipanti.length));
    st.corrente = {
      chiave: chiave(st), idx: idx, vera: vera, falsa: falsa, unita: q[2], soggetto: soggetto,
      partecipanti: partecipanti, impostori: impostori, numeri: {},
      accusati: null, delta: null, tsRivela: 0
    };
    st.fase = "scrittura";
  }

  function iniziaPartita(st, rnd) {
    if ((st.fase !== "attesa" && st.fase !== "fine") || st.giocatori.length < 3) return false;
    st.partita++; st.round = 0; st.ultimo = null;
    st.giocatori.forEach(function (g) { g.punti = 0; });
    nuovoRound(st, rnd);
    return true;
  }

  function valido(unita, v) {
    if (typeof v !== "number" || !isFinite(v) || Math.floor(v) !== v) return false;
    if (unita === "%") return v >= 0 && v <= 100;
    if (unita === "10") return v >= 1 && v <= 10;
    return v >= 0 && v <= 999999;
  }

  // ritorna true se lo stato è cambiato
  function scriviNumero(st, id, ch, v, rnd) {
    var c = st.corrente;
    if (st.fase !== "scrittura" || !c || c.chiave !== ch) return false;
    if (!dentro(c.partecipanti, id) || !valido(c.unita, v)) return false;
    if (c.numeri[id] === v) return false;
    c.numeri[id] = v;
    if (c.partecipanti.every(function (p) { return p in c.numeri; })) rivela(st, false, rnd);
    return true;
  }

  // forza = chi non ha scritto resta fuori da questo round
  function rivela(st, forza, rnd) {
    var c = st.corrente;
    if (st.fase !== "scrittura") return false;
    if (forza) c.partecipanti = c.partecipanti.filter(function (p) { return p in c.numeri; });
    if (!c.impostori.some(function (i) { return dentro(c.partecipanti, i); })) {
      nuovoRound(st, rnd, true);                // l'impostore non c'è più: si rigioca
      return "rifatto";
    }
    c.impostori = c.impostori.filter(function (i) { return dentro(c.partecipanti, i); });
    st.fase = "rivelazione";
    c.tsRivela = Date.now();
    return true;
  }

  function accusa(st, ids) {
    var c = st.corrente;
    if (st.fase !== "rivelazione") return false;
    ids = ids.filter(function (i) { return dentro(c.partecipanti, i); });
    if (!ids.length || ids.length > c.impostori.length) return false;
    var presi = c.impostori.filter(function (i) { return dentro(ids, i); });
    var delta = {};
    c.partecipanti.forEach(function (p) {
      if (dentro(c.impostori, p)) delta[p] = dentro(ids, p) ? 0 : PUNTI_IMPOSTORE_SCAPPATO;
      else delta[p] = presi.length * PUNTI_INNOCENTE_PER_IMPOSTORE_PRESO;
    });
    for (var p in delta) { var g = giocatore(st, p); if (g) g.punti += delta[p]; }
    c.accusati = ids; c.delta = delta;
    st.fase = "verdetto";
    return true;
  }

  function prossimo(st, rnd) {
    if (st.fase !== "verdetto") return false;
    st.ultimo = st.corrente;
    if (st.round >= st.totRound) { st.fase = "fine"; return true; }
    nuovoRound(st, rnd);
    return true;
  }

  function togliGiocatore(st, id, rnd) {
    var g = giocatore(st, id);
    if (!g) return false;
    st.giocatori.splice(st.giocatori.indexOf(g), 1);
    var c = st.corrente;
    if (c && st.fase === "scrittura" && dentro(c.partecipanti, id)) {
      c.partecipanti = c.partecipanti.filter(function (p) { return p !== id; });
      delete c.numeri[id];
      if (st.giocatori.length < 2) { st.fase = "attesa"; st.corrente = null; return true; }
      if (!c.impostori.some(function (i) { return i !== id; })) { nuovoRound(st, rnd, true); return true; }
      c.impostori = c.impostori.filter(function (i) { return i !== id; });
      if (c.partecipanti.every(function (p) { return p in c.numeri; })) rivela(st, false, rnd);
    }
    return true;
  }

  // Quello che vedono tutti. I numeri e la domanda vera solo dopo la rivelazione,
  // gli impostori e la loro domanda solo al verdetto.
  function vistaPubblica(st) {
    var c = st.corrente, v = {
      codice: st.codice, fase: st.fase, partita: st.partita, round: st.round,
      totRound: st.totRound, senzaPiccanti: !!st.senzaPiccanti,
      giocatori: st.giocatori.map(function (g) { return { id: g.id, nome: g.nome, colore: g.colore, punti: g.punti }; })
    };
    if (c && st.fase !== "attesa") {
      v.chiave = c.chiave; v.unita = c.unita; v.partecipanti = c.partecipanti;
      v.nImpostori = c.impostori.length;
      if (st.fase === "scrittura") v.hanno = Object.keys(c.numeri);
      else {
        v.numeri = c.numeri; v.vera = c.vera; v.tsRivela = c.tsRivela;
        if (st.fase !== "rivelazione") {
          v.impostori = c.impostori; v.falsa = c.falsa;
          v.accusati = c.accusati; v.delta = c.delta;
        }
      }
    }
    return v;
  }

  function vistaPrivata(st, id) {
    var c = st.corrente;
    if (!c || st.fase === "attesa" || !dentro(c.partecipanti, id)) return { chiave: null };
    return { chiave: c.chiave, testo: dentro(c.impostori, id) ? c.falsa : c.vera, unita: c.unita };
  }

  return {
    nuovaStanza: nuovaStanza, aggiungiGiocatore: aggiungiGiocatore, togliGiocatore: togliGiocatore,
    iniziaPartita: iniziaPartita, scriviNumero: scriviNumero, rivela: rivela, accusa: accusa,
    prossimo: prossimo, vistaPubblica: vistaPubblica, vistaPrivata: vistaPrivata,
    nImpostori: nImpostori, valido: valido, impostaPiccanti: impostaPiccanti
  };
})();
