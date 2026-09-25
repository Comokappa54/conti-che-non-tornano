// Come si parlano i telefoni.
//
// Passa tutto da due «broker» MQTT pubblici e gratuiti: nessun server nostro,
// nessun account. Ogni stanza è una cartella di argomenti:
//   .../CODICE/stato      lo stato pubblico, scritto dall'arbitro (conservato)
//   .../CODICE/p/<id>     la domanda privata di un giocatore (conservata)
//   .../CODICE/azioni     quello che mandano i giocatori all'arbitro
// «Conservato» vuol dire che il broker tiene l'ultimo messaggio e lo ridà a chi
// si collega dopo: un telefono che ricarica la pagina ritrova subito la partita.
//
// Ogni telefono sta collegato a TUTTI E DUE i broker e manda ogni messaggio su
// entrambi. Così se uno è lento o giù, l'altro basta, e nessuno resta isolato
// su un broker diverso da quello degli altri (è successo, col «ripiego» a
// cascata). I doppioni arrivano: chi riceve li scarta col numero progressivo
// che l'arbitro mette nello stato, e le azioni dei giocatori sono ripetibili.
//
// Sono broker pubblici: chi conoscesse codice e percorso potrebbe leggere.
// Per una serata tra amici va bene; niente dati personali qui dentro.

var Rete = (function () {
  var BROKER = [
    "wss://broker.hivemq.com:8884/mqtt",
    "wss://broker.emqx.io:8084/mqtt"
  ];
  var RADICE = "conti-che-non-tornano/v1/";

  var clienti = [], iscrizioni = {}, suStato = function () {}, suCollegato = null;

  function collegato() { return clienti.some(function (x) { return x.ok; }); }
  function avvisa() { suStato(collegato() ? "ok" : "collego"); }

  // suOgniCollegamento parte a ogni (ri)collegamento di ciascun broker:
  // è il momento di ripubblicare e di ribussare.
  function connetti(suOgniCollegamento) {
    suCollegato = suOgniCollegamento;
    suStato("collego");
    BROKER.forEach(function (url) {
      var x = { ok: false };
      x.c = mqtt.connect(url, {
        clientId: "cctn_" + Math.random().toString(36).slice(2, 10),
        clean: true, keepalive: 30, reconnectPeriod: 3000, connectTimeout: 10000
      });
      x.c.on("connect", function () {
        x.ok = true; avvisa();
        Object.keys(iscrizioni).forEach(function (t) { x.c.subscribe(t, { qos: 1 }); });
        if (suCollegato) suCollegato();
      });
      x.c.on("close", function () { x.ok = false; avvisa(); });
      x.c.on("offline", function () { x.ok = false; avvisa(); });
      x.c.on("error", function () {});
      x.c.on("message", function (topic, buf) {
        var testo = buf.toString();
        if (!testo || !iscrizioni[topic]) return;
        var dati; try { dati = JSON.parse(testo); } catch (e) { return; }
        iscrizioni[topic](dati);
      });
      clienti.push(x);
    });
  }

  function percorso(codice, pezzo) { return RADICE + codice + "/" + pezzo; }

  function ascolta(codice, pezzo, fn) {
    var t = percorso(codice, pezzo), nuovo = !iscrizioni[t];
    iscrizioni[t] = fn;
    if (nuovo) clienti.forEach(function (x) { if (x.ok) x.c.subscribe(t, { qos: 1 }); });
  }

  function manda(codice, pezzo, dati, conserva) {
    var t = percorso(codice, pezzo), testo = dati == null ? "" : JSON.stringify(dati);
    clienti.forEach(function (x) { if (x.ok) x.c.publish(t, testo, { qos: 1, retain: !!conserva }); });
  }

  return {
    connetti: connetti, ascolta: ascolta, manda: manda, collegato: collegato,
    suStato: function (fn) { suStato = fn; },
    quanti: function () { return clienti.filter(function (x) { return x.ok; }).length; }
  };
})();
