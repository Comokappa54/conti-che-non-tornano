// Collaudo a vuoto delle regole, senza schermo né rete:
//   jsc domande.js regole.js collaudo.js
// Gioca migliaia di round con giocatori che entrano, escono e ricaricano,
// e controlla che niente trapeli e che i conti tornino.

var seme = 12345;
function rnd() { seme = (seme * 1103515245 + 12345) % 2147483648; return seme / 2147483648; }
var errori = [], conta = { round: 0, rifatti: 0, presi: 0, scappati: 0, partite: 0 };
var unita = { n: 0, "%": 0, "10": 0 }, doppioni = 0, conG = 0, piccanti = 0;
function err(m) { if (errori.length < 30) errori.push(m); }

// il mazzo: niente doppioni, unità valide, {G} coerente
var visti = {};
MAZZO.forEach(function (q, i) {
  if (q.length < 4 || q.length > 5 || (q.length === 5 && q[4] !== "+") || !(q[2] in unita)) err("coppia " + i + " malformata");
  if (q[4] === "+") piccanti++;
  unita[q[2]]++;
  [q[0], q[1]].forEach(function (t) { if (visti[t]) err("domanda doppia: " + t); visti[t] = 1; });
  if ((q[0].indexOf("{G}") >= 0) !== (q[1].indexOf("{G}") >= 0)) err("{G} solo da una parte: " + i);
  if (q[0].indexOf("{G}") >= 0) conG++;
  if (q[2] === "%" && !/percentual/i.test(q[0] + q[1])) err("% senza percentuale: " + i);
  if (q[2] === "10" && !(/1 a 10/.test(q[0]) && /1 a 10/.test(q[1]))) err("scala senza 1 a 10: " + i);
});

for (var sessione = 0; sessione < 300; sessione++) {
  var st = Regole.nuovaStanza("TEST", rnd), n = 3 + Math.floor(rnd() * 8), k = 0;
  for (var i = 0; i < n; i++) Regole.aggiungiGiocatore(st, "g" + (k++), "Nome" + i);
  var usateSessione = {}, chiaviViste = {};
  var famiglia = rnd() < 0.5; Regole.impostaPiccanti(st, famiglia);
  var partite = 1 + Math.floor(rnd() * 4);
  for (var p = 0; p < partite; p++) {
    if (!Regole.iniziaPartita(st, rnd)) { err("partita non partita"); break; }
    conta.partite++;
    var guardia = 0;
    while (st.fase !== "fine" && guardia++ < 200) {
      var c = st.corrente, pub = Regole.vistaPubblica(st);
      if (st.fase === "scrittura") {
        if (pub.numeri || pub.vera || pub.impostori) err("trapela in scrittura");
        if (c.impostori.length !== Regole.nImpostori(c.partecipanti.length) && !c.rifatto) {
          // può scendere solo se qualcuno è uscito a round iniziato
        }
        if (!usateSessione[c.chiave]) {
          usateSessione[c.chiave] = 1;
          if (usateSessione["q" + c.idx] && st.prossima > 1) doppioni++;
          usateSessione["q" + c.idx] = 1;
        }
        if (famiglia && MAZZO[c.idx][4] === "+") err("piccante uscita in modalità senza piccanti");
        if (c.vera.indexOf("{G}") >= 0 || c.falsa.indexOf("{G}") >= 0) err("{G} non sostituito");
        var imp = 0;
        c.partecipanti.forEach(function (id) {
          var pr = Regole.vistaPrivata(st, id);
          if (pr.testo === c.falsa) imp++;
          if (pr.testo !== c.vera && pr.testo !== c.falsa) err("privata sbagliata");
        });
        if (imp !== c.impostori.length) err("impostori privati " + imp + " vs " + c.impostori.length);
        // imprevisti
        var r = rnd();
        if (r < 0.02 && st.giocatori.length > 3) { Regole.togliGiocatore(st, c.partecipanti[0], rnd); continue; }
        if (r < 0.04) { Regole.aggiungiGiocatore(st, "g" + (k++), "Nome" + Math.floor(rnd() * 12)); }
        if (r < 0.05) { var prima = st.round; if (Regole.rivela(st, true, rnd) === "rifatto") { conta.rifatti++; if (st.round !== prima) err("rifatto cambia round"); } continue; }
        var chi = c.partecipanti.filter(function (id) { return !(id in c.numeri); })[0];
        var v = c.unita === "%" ? Math.floor(rnd() * 101) : c.unita === "10" ? 1 + Math.floor(rnd() * 10) : Math.floor(rnd() * 50);
        if (rnd() < 0.05) Regole.scriviNumero(st, chi, "vecchia", v, rnd);           // messaggio in ritardo
        if (chiaviViste[c.chiave] && chiaviViste[c.chiave] !== c.idx) err("stessa chiave per due domande");
        chiaviViste[c.chiave] = c.idx;
        if (Regole.scriviNumero(st, chi, c.chiave, 101 + 1e7, rnd)) err("numero fuori scala accettato");
        Regole.scriviNumero(st, chi, c.chiave, v, rnd);
      } else if (st.fase === "rivelazione") {
        if (pub.impostori || pub.falsa) err("trapela l'impostore in rivelazione");
        if (Object.keys(c.numeri).length !== c.partecipanti.length) err("numeri incompleti alla rivelazione");
        var puntiPrima = st.giocatori.reduce(function (s, g) { return s + g.punti; }, 0);
        var acc = c.partecipanti.slice().sort(function () { return rnd() - 0.5; }).slice(0, c.impostori.length);
        Regole.accusa(st, acc);
        var presi = c.impostori.filter(function (i) { return acc.indexOf(i) >= 0; }).length;
        conta.presi += presi; conta.scappati += c.impostori.length - presi;
        var atteso = presi * (c.partecipanti.length - c.impostori.length) + (c.impostori.length - presi) * 3;
        var dopo = st.giocatori.reduce(function (s, g) { return s + g.punti; }, 0);
        if (dopo - puntiPrima !== atteso) err("punti: +" + (dopo - puntiPrima) + " invece di +" + atteso);
        conta.round++;
      } else if (st.fase === "verdetto") {
        Regole.prossimo(st, rnd);
      } else { err("fase strana " + st.fase); break; }
    }
    if (st.fase !== "fine") err("partita bloccata in " + st.fase);
    if (st.round !== 10) err("partita di " + st.round + " round");
  }
}

// ripresa col nome: stesso posto, stessi punti
var st2 = Regole.nuovaStanza("X", rnd);
["Anna", "Bea", "Carlo", "Dario"].forEach(function (nm, i) { Regole.aggiungiGiocatore(st2, "a" + i, nm); });
Regole.iniziaPartita(st2, rnd);
var imp0 = st2.corrente.impostori[0];
var nomeImp = st2.giocatori.filter(function (g) { return g.id === imp0; })[0].nome;
Regole.aggiungiGiocatore(st2, "nuovo", " " + nomeImp.toUpperCase() + " ");
if (st2.corrente.impostori[0] !== "nuovo") err("ripresa: l'impostore non segue il nuovo id");
if (Regole.vistaPrivata(st2, "nuovo").testo !== st2.corrente.falsa) err("ripresa: domanda persa");
if (st2.giocatori.length !== 4) err("ripresa: giocatore duplicato");

// senza piccanti per 30 partite di fila: mai una piccante, mai un doppione prima del rimescolo
var st3 = Regole.nuovaStanza("F", rnd), viste3 = {}, doppie3 = 0, piccanti3 = 0, round3 = 0;
["A", "B", "C", "D"].forEach(function (nm, i) { Regole.aggiungiGiocatore(st3, "f" + i, nm); });
Regole.impostaPiccanti(st3, true);
for (var p3 = 0; p3 < 30; p3++) {
  Regole.iniziaPartita(st3, rnd);
  if (Regole.impostaPiccanti(st3, false)) err("piccanti cambiate a partita in corso");
  while (st3.fase !== "fine") {
    var c3 = st3.corrente;
    if (MAZZO[c3.idx][4] === "+") piccanti3++;
    if (viste3[c3.idx] && round3 < MAZZO.length - 16) doppie3++;
    viste3[c3.idx] = 1; round3++;
    c3.partecipanti.forEach(function (id) { Regole.scriviNumero(st3, id, c3.chiave, 1, rnd); });
    Regole.accusa(st3, [c3.partecipanti[0]]); Regole.prossimo(st3, rnd);
  }
}
if (piccanti3) err("senza piccanti: ne sono uscite " + piccanti3);
if (doppie3) err("senza piccanti: " + doppie3 + " doppioni prima di finire il mazzo");
// e rimettendole dopo, le piccanti saltate sono ancora lì
Regole.impostaPiccanti(st3, false);
var rimaste = st3.mazzo.slice(st3.prossima).filter(function (i) { return MAZZO[i][4] === "+"; }).length;

print("piccanti: " + piccanti + " (rimaste nel mazzo dopo 30 partite senza: " + rimaste + ")");
print("coppie nel mazzo: " + MAZZO.length + "  (numeri " + unita.n + ", percentuali " + unita["%"] + ", da 1 a 10 " + unita["10"] + ", su un giocatore " + conG + ")");
print("partite " + conta.partite + ", round " + conta.round + ", rifatti " + conta.rifatti + ", impostori presi " + conta.presi + ", scappati " + conta.scappati);
print("domande ripetute prima di finire il mazzo: " + doppioni);
print(errori.length ? "ERRORI:\n  " + errori.join("\n  ") : "nessun errore");
