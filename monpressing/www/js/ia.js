// Fonctions IA de MonPressing : l'appli appelle directement l'API Claude (Anthropic)
// avec la clé saisie par l'administrateur dans Paramètres (gardée dans le téléphone).
const CONTEXTE = "Tu es l'assistant de MonPressing, une application de gestion de pressing au Bénin (Cotonou, Porto-Novo, Abomey-Calavi...). " +
  'Monnaie : franc CFA, noté F. Les clients paient en espèces ou en Mobile Money (MTN MoMo, Moov Money, Celtiis Cash) et communiquent par WhatsApp. ' +
  'Réponds toujours en français simple et clair.';

export const MODELE_TEXTE = 'claude-haiku-5-5';
export const MODELE_VISION = 'claude-sonnet-5-5';

async function claude(cfg, model, system, content, max_tokens = 800) {
  let r;
  try {
    r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': cfg.key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({ model, max_tokens, system, messages: [{ role: 'user', content }] }),
    });
  } catch (e) { throw new Error('pas de connexion internet'); }
  let j = {};
  try { j = await r.json(); } catch (e) {}
  if (!r.ok) {
    if (r.status === 401) throw new Error('clé API refusée : vérifiez-la dans Paramètres');
    throw new Error((j.error && j.error.message) || `erreur ${r.status}`);
  }
  return (j.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
}

function json(txt) {
  const m = txt.match(/[\[{][\s\S]*[\]}]/);
  if (!m) throw new Error('réponse IA illisible');
  return JSON.parse(m[0]);
}
const image = (b64) => ({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b64 } });
const J = (x) => JSON.stringify(x);

const TACHES = {
  // Photo au dépôt : reconnaître le vêtement, les taches et les dégâts
  photo_article: async (c, b) => json(await claude(c, c.vision, CONTEXTE, [image(b.image), { type: 'text', text:
    `Photo d'un vêtement déposé au pressing.\nCatalogue du pressing : ${J(b.catalogue)}.\n` +
    'Réponds UNIQUEMENT en JSON : {"article":"<nom EXACT du catalogue le plus proche>","couleur":"...","taches":["..."],"degats":["trou, déchirure, bouton manquant, couleur passée... seulement si visible"],"confiance":"haute|moyenne|faible"}. ' +
    "Mets des listes vides si rien n'est visible. N'invente rien." }], 400)),

  // Dictée vocale de la commande
  dictee: async (c, b) => json(await claude(c, c.texte, CONTEXTE,
    `Un employé a dicté une commande : "${b.texte}".\nCatalogue : ${J(b.catalogue)}.\nClients connus : ${J(b.clients || [])}.\n` +
    'Réponds UNIQUEMENT en JSON : {"lignes":[{"article":"<nom EXACT du catalogue>","qte":1}],"express":false,"client":"<nom tel qu\'écrit dans la liste des clients si reconnu, sinon le nom entendu, sinon null>"}', 500)),

  // Message de relance des impayés
  relance: (c, b) => claude(c, c.texte, CONTEXTE,
    `Écris un message WhatsApp de relance de paiement (4 phrases maximum) pour ce client : ${J(b.client)}. ` +
    `Ton : ${b.ton}. Pressing : ${b.pressing}. Moyens de paiement : ${b.paiement || 'espèces au pressing'}. ` +
    'Vouvoiement, respectueux, chaleureux et efficace. Donne seulement le message, sans guillemets.', 300),

  // Idées de promotions
  promos: async (c, b) => json(await claude(c, c.texte, CONTEXTE,
    `Statistiques du pressing : ${J(b.stats)}.\nDate du jour : ${b.date}.\nÉvénements à venir : ${J(b.evenements)}.\n` +
    'Propose 3 promotions adaptées au contexte béninois (fêtes, cérémonies, mariages, enterrements, rentrée, jours calmes, clients inactifs), différentes des promotions existantes. ' +
    'Réponds UNIQUEMENT en JSON : [{"nom":"...","type":"pourcent|montant","valeur":10,"jours":[],"debut":"AAAA-MM-JJ ou vide","fin":"AAAA-MM-JJ ou vide","cible":"tous|nouveaux|inactifs","articles":[],"minimum":0,"raison":"une phrase"}]. ' +
    'jours : liste de 0 à 6 (0 = dimanche), vide = tous les jours. articles : noms exacts du catalogue, vide = tous.', 900)),

  // Assistant du patron
  assistant: (c, b) => claude(c, c.texte,
    CONTEXTE + " Tu aides le patron à comprendre son activité à partir des données fournies. N'invente aucun chiffre : si l'information manque, dis-le. Réponse courte, pratique, avec un conseil concret si c'est utile.",
    `Données du pressing : ${J(b.donnees)}\n\nQuestion du patron : ${b.question}`, 700),

  // Conseils de détachage à partir d'une photo
  detachage: (c, b) => claude(c, c.vision, CONTEXTE + ' Tu es un expert en détachage textile.', [image(b.image), { type: 'text', text:
    `Tissu : ${b.tissu || 'inconnu'}. Couleur : ${b.couleur || '?'}. Tache supposée : ${b.tache || '?'}.\n` +
    'Donne : 1) le type de tache probable, 2) le traitement étape par étape avec des produits faciles à trouver au Bénin, ' +
    "3) les risques (décoloration du wax, bazin, tissu fragile) et ce qu'il ne faut PAS faire. Rappelle de tester sur une partie cachée. Réponse courte." }], 700),
};

// cfg = { key, texte, vision }
export async function executer(tache, donnees, cfg) {
  if (!cfg || !cfg.key) throw new Error("IA non configurée : ajoutez la clé API dans Paramètres");
  const f = TACHES[tache];
  if (!f) throw new Error('tâche inconnue : ' + tache);
  return f({ key: cfg.key.trim(), texte: cfg.texte || MODELE_TEXTE, vision: cfg.vision || MODELE_VISION }, donnees);
}
