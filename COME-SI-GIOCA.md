# Conti che non tornano — come si gioca

Gioco da serata, nella stessa stanza, da 3 a 12 persone. Ognuno usa il suo telefono.

## La regola

1. Ognuno legge **la sua domanda** sul telefono e scrive un numero: un conteggio,
   una percentuale o un voto da 1 a 10.
2. Tutti hanno la stessa domanda. Tranne l'impostore, che ne ha una gemella
   diversa, e **non lo sa**.
3. Quando tutti hanno scritto, le lavagnette si girano insieme e compare la
   domanda vera.
4. Ora l'impostore ha capito di esserlo, e deve difendere il suo numero come se
   avesse letto la domanda giusta. Gli altri devono difendere il loro, perché a
   volte il numero strano è di un innocente.
5. Si discute a voce e ci si mette d'accordo su chi accusare. Chi ha creato la
   stanza lo segna sul telefono.

Un impostore ogni quattro giocatori: 1 fino a 7, 2 da 8 in su.
Una partita dura 10 round. Rigiocando nella stessa stanza, le domande non si ripetono.

## Punti (provvisori)

- Impostore scoperto: **+1** a ogni innocente.
- Impostore che la fa franca: **+3** a lui.

Si cambiano in cima a `js/regole.js`.

## Come si avvia

Uno crea la stanza e gli altri entrano col codice di quattro lettere, oppure col
link del pulsante «Invita gli altri».

Il telefono di chi ha creato la stanza fa da arbitro: **deve restare con la
pagina aperta** e lo schermo acceso. Il gioco prova a tenerlo acceso da solo.
Se qualcuno ricarica la pagina, rientra al suo posto. Se entra con lo stesso
nome da un altro telefono, riprende il posto di prima.

Se c'è una tv o un portatile, «Usa questo schermo come tavolo» mostra a tutti le
lavagnette in grande. Non è obbligatorio.

## Come si collegano i telefoni

Passano da un servizio pubblico gratuito (un «broker» MQTT: HiveMQ, con EMQX di
riserva). Non ci sono server nostri né account. Serve internet su tutti i
telefoni. Chi conoscesse il codice della stanza potrebbe in teoria leggere i
messaggi: per una serata tra amici non importa, ma non ci passano dati personali.

## File

- `js/domande.js`: il mazzo (247 coppie). **Non aprirlo se vuoi giocare.**
- `js/regole.js`: le regole. Girano solo sul telefono dell'arbitro.
- `js/rete.js`: il collegamento tra telefoni.
- `js/app.js`: le schermate.
- `js/collaudo.js`: il collaudo a vuoto delle regole, lanciato con
  `jsc domande.js regole.js collaudo.js` dalla cartella `js`.
