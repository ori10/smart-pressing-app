# MonPressing = Smart Pressing + IA

MonPressing reprend **Smart Pressing tel quel** : même design et mêmes fonctions (factures, étapes jusqu'au cousin, codes
des pièces, photos, réclamations, clients, arriérés, lavage cousin ou maison, promotions, fidélité, relances WhatsApp,
dépenses, bilans PDF et Excel, sauvegardes). Les nouveautés s'ajoutent par-dessus.
C'est une appli séparée (`com.monpressing.app`) : elle s'installe **à côté** de Smart Pressing, avec ses propres données.

## Ce qui s'ajoute
| Où | Nouveauté |
|---|---|
| Nouvelle facture | **🎤 Dicter la commande** (« trois chemises, deux pantalons, un boubou pour Madame Houngbo ») |
| Nouvelle facture | **📷 Photo + IA** : l'IA reconnaît le vêtement, ajoute l'article et note les taches et dégâts ; la photo est rangée sur la pièce |
| Nouvelle facture | **Date de rendu conseillée** (saison des pluies, charge de l'atelier, lavage maison) |
| Facture | **🔍 Taches et dégâts (IA)** sur la photo de chaque pièce, notés sur la pièce |
| Relances | **Profil de paiement** de chaque client (bon payeur en retard / à surveiller / risque élevé), **bon moment** pour relancer (du 25 au 5), **message rédigé par l'IA** |
| Promotions | **💡 Idées de promotions** : jour le plus calme, fêtes béninoises (10 janvier, Pâques, Tabaski, 1er août, rentrée, fin d'année), saison des cérémonies, et idées de l'IA. Un toucher remplit le formulaire. |
| Plus › Caisse du jour | **Clôture de caisse** (espèces + Mobile Money) comparée aux paiements enregistrés |
| Accueil (admin) | **🚨 À vérifier** : écarts de caisse, factures supprimées, paiements annulés, remises libres trop fréquentes, livraisons sans paiement |
| Plus › Assistant du patron | Questions en français, à l'écrit ou au micro ; réponses lues à voix haute ou envoyées sur WhatsApp |
| Plus › Conseils de détachage | Photo de la tache → conseils de l'IA selon le tissu ; guide utilisable sans internet |
| Plus › Intelligence artificielle | Clé API Claude (console.anthropic.com), gardée dans le téléphone et jamais mise dans les sauvegardes |
| Sauvegarde | Sauvegarde chiffrée en ligne dans le **même bucket Supabase que Smart Pressing (`sauvegardes`)**, dans son propre dossier `sauvegardes/monpressing/`. Restaure aussi les **sauvegardes de Smart Pressing**. |

Sans clé IA, tout marche quand même : la dictée, les idées de promotions, les profils, la date conseillée, la caisse
et l'assistant fonctionnent avec des règles simples.

## Obtenir l'APK
**Actions > Construire l'APK MonPressing** se lance à chaque modification de `monpressing/`. L'APK `MonPressing.apk` apparaît dans
**Releases** (versions `monpressing-v1.0.N`). Smart Pressing reste la version « Latest ».
La clé de signature est `android/app/monpressing.keystore` : ne la supprimez pas, sinon les mises à jour ne s'installent plus.

Version iPhone : https://ori10.github.io/smart-pressing-app/monpressing/

## Mettre à jour MonPressing avec les nouveautés de Smart Pressing
Le code de Smart Pressing est copié tel quel dans `www/`. Les ajouts sont regroupés dans `js/plus.js` (règles) et `js/ia.js`
(appels à l'IA). Dans `js/app.js`, ils sont branchés aux endroits marqués « MonPressing ».
