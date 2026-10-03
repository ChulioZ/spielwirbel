'use strict';

/* The „Was spielen wir heute?" guide (#1171) in Spanish, translated from the
   German reference (lib/guide-text/de.js). Content rules: lib/guide.js header.
   Never « noche »/« velada » (test/session-naming.test.js scans these values —
   « hoy » says when without naming the entity), never a device kind. */

module.exports = {
  title: '¿A qué jugamos hoy? Cómo vuestro grupo elige un juego rápido',
  description: '¿Estantería llena y ningún acuerdo? Cómo deciden los grupos qué sale a la mesa, qué importa de verdad al elegir y un método que funciona en diez minutos.',
  h1: '¿A qué jugamos hoy?',
  lead: `
        <p>La estantería está llena, ya ha llegado todo el mundo, hay algo de beber… y empieza la discusión. «Me da igual». «Lo que sea, pero no el largo otra vez». «¿Qué más tenemos?». Veinte minutos después acaba en la mesa el juego de siempre, y las compras nuevas siguen con el plástico puesto.</p>
        <p>Esta guía recoge cómo suelen resolver la pregunta los grupos de juego, qué importa de verdad al elegir y cómo llegar en pocos minutos a una decisión con la que todos puedan vivir, con o sin app.</p>`,
  sections: [
    {
      h: 'Cómo deciden hoy los grupos',
      html: `<p>Casi cada grupo tiene su costumbre, a menudo sin haberla acordado nunca. Las cuatro más habituales:</p>
      <ul>
        <li><strong>Por turnos.</strong> Cada vez elige alguien distinto, muchas veces quien pone la casa. A lo largo de los meses es justo, pero no para hoy: a quien no le gusta el juego elegido, le toca aguantarse.</li>
        <li><strong>Quien explica, decide.</strong> Propone la persona que se sabe las reglas. Ahorra tiempo, pero hace que siempre sea la misma persona la que marca el gusto de todo el grupo.</li>
        <li><strong>El azar.</strong> Tirar un dado, sacar un papelito, una app de sorteos. Nadie tiene que mojarse, pero el azar no sabe que hoy solo hay dos horas o que alguien no soporta un juego concreto.</li>
        <li><strong>Votar.</strong> A mano alzada o con el pulgar. Es rápido, pero a la vista: quien vota el último suele sumarse a la mayoría y las dudas discretas se pierden. Un voto secreto con papelitos es más sincero, pero engorroso, y solo cuenta lo más popular, no lo que alguien no quiere jugar de ninguna manera.</li>
      </ul>
      <p>Ninguno de estos métodos está mal. Pero comparten un problema: deciden antes de saber qué juegos tienen sentido hoy.</p>`,
    },
    {
      h: 'Lo que importa de verdad al elegir',
      html: `<p>Antes de hablar de gustos, conviene mirar los límites duros. Suelen descartar por sí solos la mayor parte de la estantería.</p>
      <ul>
        <li><strong>¿Cuántos jugáis?</strong> La caja dice «2–6», pero muchos juegos solo brillan con un número concreto. Elegir entre cinco un juego que luce a cuatro es menos divertido para todos.</li>
        <li><strong>¿Cuánto tiempo tenéis?</strong> Contado con sinceridad, con montaje y explicación incluidos. Un juego que promete «60–120 minutos» rara vez dura solo 60 con un grupo nuevo.</li>
        <li><strong>¿Cuánta cabeza queda hoy?</strong> Después de una semana larga, un juego ligero suele encajar mejor que ese juego de estrategia exigente al que todos tienen ganas en el fondo.</li>
        <li><strong>¿Quién conoce las reglas?</strong> Un juego nuevo necesita a alguien que lo explique y paciencia por parte de los demás. Uno conocido puede empezar al momento.</li>
        <li><strong>¿Hay un «no» claro?</strong> Un juego que una persona de verdad no quiere jugar casi siempre es la peor opción, aunque al resto le guste. Un veto pesa más que una ligera preferencia.</li>
        <li><strong>¿Está la caja aquí?</strong> Si os reunís en casas distintas, puede que el juego esté en la estantería equivocada.</li>
      </ul>`,
    },
    {
      h: 'Un método para hoy, en diez minutos',
      html: `<ol>
        <li><strong>Primero filtrar, luego hablar.</strong> Tachad todo lo que no encaje con el número de personas, el tiempo disponible o el ánimo.</li>
        <li><strong>Sacar una lista corta.</strong> Bastan de tres a cinco juegos; más candidatos no hacen mejor la elección, solo más larga. Si nadie quiere mojarse, que decida el azar, pero solo entre lo que queda tras filtrar.</li>
        <li><strong>Cada persona valora cada juego, por su cuenta.</strong> Basta una escala del 1 («nada») al 5 («muchísimo»). Lo único importante es que nadie vea las respuestas de los demás antes de que todos hayan terminado.</li>
        <li><strong>Tomarse en serio el veto.</strong> Un juego con un 1 baja en la lista, aunque su media parezca buena.</li>
        <li><strong>El ganador sale a la mesa.</strong> Se juega el que tiene mejor valoración. Sin renegociar.</li>
      </ol>
      <p>Esto funciona con papelitos y un boli. Solo se vuelve pesado si lo hacéis desde cero cada vez, y para eso existe Spielwirbel.</p>`,
    },
    {
      h: 'Cómo lo hace Spielwirbel',
      html: `<p>Spielwirbel es una app web para grupos de juego que se encarga de este método. Vuestro grupo monta su estantería una vez: a mano o buscando en BoardGameGeek, que trae el título, la portada y el número de jugadores.</p>
      <p>Cuando queréis jugar, elegís quién se sienta hoy a la mesa. Spielwirbel sortea entonces un puñado de juegos que encajan exactamente con ese número de personas. Si queréis, acotad antes: por las etiquetas propias del grupo y, en los juegos vinculados a BoardGameGeek, por duración, complejidad y lo que la comunidad de BoardGameGeek recomienda para ese número de jugadores. Si habéis anotado de quién es cada caja, se quedan fuera los juegos cuyos dueños no están hoy.</p>
      <p>Después cada persona valora los juegos sorteados del 1 al 5: por turnos en un dispositivo que se va pasando, o en su propio dispositivo mediante un enlace compartido o un código QR, sin cuenta. Las valoraciones son secretas hasta que se cierra la votación. Entonces Spielwirbel muestra la clasificación, y un «nada» pesa más de lo que sugiere su número, para que se juegue lo que a todos les apetece.</p>
      <p>Anotáis qué se jugó y quién ganó. Con cada sesión vuestro grupo conoce mejor su gusto: qué juegos funcionan y cuáles vuelven una y otra vez a la mesa.</p>`,
    },
  ],
  cta: {
    title: 'Pruébalo tú mismo',
    demoText: 'La demo abre un grupo ya preparado, con juegos y sesiones pasadas, sin correo y sin contraseña. Se borra sola al cabo de un tiempo.',
    demoButton: 'Iniciar la demo',
    openText: 'Spielwirbel funciona en el navegador; no hay nada que instalar.',
    openButton: 'Abrir Spielwirbel',
  },
  chrome: {
    note: 'Traducción: la versión alemana es el texto de referencia.',
    back: '← A Spielwirbel',
    faq: 'Preguntas frecuentes',
    langs: 'Idiomas',
  },
};
