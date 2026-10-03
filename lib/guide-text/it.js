'use strict';

/* The „Was spielen wir heute?" guide (#1171) in Italian, translated from the
   German reference (lib/guide-text/de.js). Content rules: lib/guide.js header.
   Never « sera »/« serata » (test/session-naming.test.js scans these values —
   « stasera » says when without naming the entity), never a device kind. */

module.exports = {
  title: 'A cosa giochiamo stasera? Come il gruppo sceglie un gioco in fretta',
  description: 'Scaffale pieno e nessun accordo? Come decidono i gruppi cosa portare in tavola, cosa conta davvero nella scelta – e un metodo che funziona in dieci minuti.',
  h1: 'A cosa giochiamo stasera?',
  lead: `
        <p>Lo scaffale è pieno, sono arrivati tutti, da bere c’è – e comincia la discussione. «Per me è uguale.» «Basta che non sia di nuovo quello lungo.» «Cos’altro abbiamo?» Venti minuti dopo sul tavolo c’è il gioco di sempre, e gli acquisti nuovi sono ancora nel cellophane.</p>
        <p>Questa guida raccoglie come i gruppi di gioco risolvono di solito la questione, cosa conta davvero nella scelta e come arrivare in pochi minuti a una decisione che vada bene a tutti – con o senza app.</p>`,
  sections: [
    {
      h: 'Come decidono oggi i gruppi',
      html: `<p>Quasi ogni gruppo ha la sua abitudine, spesso senza averla mai decisa. Le quattro più comuni:</p>
      <ul>
        <li><strong>A turno.</strong> Ogni volta sceglie qualcuno di diverso, spesso chi ospita. Nel tempo è giusto, ma non per oggi: a chi non piace il gioco scelto tocca adattarsi.</li>
        <li><strong>Chi spiega, decide.</strong> Propone la persona che conosce le regole. Si risparmia tempo, ma è sempre la stessa persona a plasmare il gusto di tutto il gruppo.</li>
        <li><strong>Il caso.</strong> Un dado, un bigliettino estratto, un’app di sorteggio. Nessuno deve sbilanciarsi – ma il caso non sa che oggi ci sono solo due ore, o che qualcuno non sopporta un certo gioco.</li>
        <li><strong>Votare.</strong> Per alzata di mano o con il pollice. Veloce, ma palese: chi vota per ultimo di solito segue la maggioranza e i dubbi sussurrati si perdono. Un voto segreto su bigliettini è più sincero, ma macchinoso – e conta solo ciò che piace di più, non ciò che qualcuno non vuole giocare per nessun motivo.</li>
      </ul>
      <p>Nessuno di questi metodi è sbagliato. Hanno però lo stesso problema: decidono prima che sia chiaro quali giochi abbiano senso oggi.</p>`,
    },
    {
      h: 'Cosa conta davvero nella scelta',
      html: `<p>Prima di parlare di gusti, conviene guardare i limiti rigidi. Di solito bastano da soli a escludere gran parte dello scaffale.</p>
      <ul>
        <li><strong>Quanti giocano?</strong> Sulla scatola c’è scritto «2–6», ma molti giochi rendono davvero solo con un certo numero. Scegliere in cinque un gioco che dà il meglio in quattro diverte meno tutti.</li>
        <li><strong>Quanto tempo avete?</strong> Contato con onestà, preparazione e spiegazione comprese. Un gioco che promette «60–120 minuti» con un gruppo nuovo raramente ne dura solo 60.</li>
        <li><strong>Quanta testa è rimasta?</strong> Dopo una settimana lunga, un gioco leggero spesso è più adatto del pesante gioco di strategia che sotto sotto tutti aspettano.</li>
        <li><strong>Chi conosce le regole?</strong> Un gioco nuovo richiede qualcuno che lo spieghi e pazienza da parte degli altri. Uno conosciuto può partire subito.</li>
        <li><strong>C’è un no deciso?</strong> Un gioco che una persona proprio non vuole giocare è quasi sempre la scelta peggiore, anche se a tutti gli altri piace. Un veto pesa più di una leggera preferenza.</li>
        <li><strong>La scatola c’è?</strong> Se vi trovate a turno a casa di persone diverse, il gioco potrebbe essere sullo scaffale sbagliato.</li>
      </ul>`,
    },
    {
      h: 'Un metodo per stasera, in dieci minuti',
      html: `<ol>
        <li><strong>Prima filtrare, poi parlare.</strong> Scartate tutto ciò che non va bene per il numero di persone, il tempo a disposizione o l’umore.</li>
        <li><strong>Estrarre una rosa breve.</strong> Bastano da tre a cinque giochi; più candidati non rendono la scelta migliore, solo più lunga. Se nessuno vuole sbilanciarsi, estraete a caso – ma solo tra ciò che resta dopo il filtro.</li>
        <li><strong>Ognuno valuta ogni gioco, per conto suo.</strong> Basta una scala da 1 («per niente») a 5 («moltissima»). Conta solo che nessuno veda le risposte degli altri prima che tutti abbiano finito.</li>
        <li><strong>Prendere sul serio il veto.</strong> Un gioco con un 1 scende in classifica, anche se la media sembra buona.</li>
        <li><strong>Il vincitore va in tavola.</strong> Si gioca quello con la valutazione migliore. Niente rinegoziazioni.</li>
      </ol>
      <p>Funziona anche con bigliettini e una penna. Diventa faticoso solo se ricominciate da capo ogni volta – ed è proprio per questo che esiste Spielwirbel.</p>`,
    },
    {
      h: 'Come lo fa Spielwirbel',
      html: `<p>Spielwirbel è un’app web per gruppi di gioco che si occupa di questo metodo. Il vostro gruppo crea il suo scaffale una volta sola – a mano o cercando su BoardGameGeek, che porta con sé titolo, copertina e numero di giocatori.</p>
      <p>Quando volete giocare, scegliete chi siede al tavolo oggi. Spielwirbel estrae allora una manciata di giochi adatti esattamente a quel numero di persone. Se volete, restringete prima: per le etichette del gruppo e, per i giochi collegati a BoardGameGeek, per durata, complessità e in base a ciò che la community di BoardGameGeek consiglia per quel numero di giocatori. Se avete indicato di chi è ogni scatola, restano fuori i giochi i cui proprietari oggi non ci sono.</p>
      <p>Poi ognuno valuta i giochi estratti da 1 a 5 – a turno su un dispositivo che passa di mano in mano, oppure sul proprio dispositivo tramite un link condiviso o un codice QR, senza alcun account. Le valutazioni restano segrete finché la votazione non viene chiusa. A quel punto Spielwirbel mostra la classifica, e un «per niente» pesa più di quanto dica il suo numero – così si gioca a ciò che va a tutti.</p>
      <p>Registrate cosa si è giocato e chi ha vinto. A ogni sessione il vostro gruppo conosce meglio i suoi gusti: quali giochi piacciono e quali tornano sempre in tavola.</p>`,
    },
  ],
  cta: {
    title: 'Provalo tu stesso',
    demoText: 'La demo apre un gruppo già pronto, con giochi e sessioni passate – senza e-mail e senza password. Si cancella da sola dopo un po’.',
    demoButton: 'Avvia la demo',
    openText: 'Spielwirbel funziona nel browser; non c’è niente da installare.',
    openButton: 'Apri Spielwirbel',
  },
  chrome: {
    note: 'Traduzione – il testo di riferimento è la versione tedesca.',
    back: '← A Spielwirbel',
    faq: 'Domande frequenti',
    langs: 'Lingue',
  },
};
