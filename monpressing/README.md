# MonPressing : deuxième application Android (avec IA)

MonPressing est construite **comme Smart Pressing**. C'est une appli Capacitor sans serveur : les données restent dans le
téléphone (IndexedDB), avec une sauvegarde automatique **chiffrée** dans Supabase.
Elle a son propre identifiant (`com.monpressing.app`) et s'installe **à côté** de Smart Pressing, sans la toucher.

## Ce qu'elle fait en plus
- **Photo au dépôt + IA** : l'IA reconnaît le vêtement, note les taches et les dégâts. La photo est datée, c'est la preuve en cas de litige.
- **Facture dictée** : « trois chemises, deux pantalons, un boubou bazin, express, pour Madame Houngbo ».
- **Arriérés** à la facture, **choix cousin** article par article (avec suggestion), **promotions** créées par l'admin et idées de
  promotions (fêtes béninoises, jours calmes, clients inactifs, IA).
- **Date de retrait réaliste** : elle tient compte du cousin, de la saison des pluies et de la charge de l'atelier.
- **Recouvrement** : profil de risque, relances WhatsApp (polie, ferme ou rédigée par l'IA) au bon moment (du 25 au 5).
- **Caisse** : clôture à l'aveugle et alertes (écarts, annulations, remises, habits remis sans paiement).
- **Assistant du patron** (questions en français, réponses lues à voix haute), **conseils de détachage** par photo.
- Plusieurs utilisateurs sur le même téléphone, chacun avec son code PIN (patron = admin, employés).

## Obtenir l'APK
Chaque envoi sur `main` qui modifie `monpressing/` déclenche **Actions > Construire l'APK MonPressing** (environ 5 min).
Le fichier `MonPressing.apk` apparaît dans **Releases** (versions `monpressing-v1.0.N`). Smart Pressing reste la version « Latest ».
Les mises à jour s'installent par-dessus sans perdre les données (clé de signature : `android/app/monpressing.keystore`, ne la supprimez pas).

Version iPhone : **https://ori10.github.io/smart-pressing-app/monpressing/**, à ouvrir dans Safari puis « Sur l'écran d'accueil ».

## Premier démarrage
1. Choisissez **Patron**, PIN **0000**, puis changez-le dans Paramètres.
2. **Paramètres > Intelligence artificielle** : collez votre clé API Claude (console.anthropic.com). Chaque utilisation coûte
   quelques francs, payés sur ce compte. Sans clé, l'appli marche quand même : la dictée, les relances, les promotions et
   l'assistant ont un mode simple sans IA.
3. **Paramètres > Sauvegarde automatique en ligne** : suivez le guide intégré. Il crée le bucket Supabase **`saves`** avec le code
   SQL à copier ; renseignez ensuite l'adresse, la clé publique et un mot de passe de sauvegarde. Chaque soir à partir de 19 h,
   la copie du jour part dans `saves/monpressing/sauvegarde-AAAA-MM-JJ.json`.
4. Nouveau téléphone : écran de connexion > « Restaurer depuis internet » ou « Restaurer une sauvegarde ».

## Structure
```
monpressing/
  www/               l'application (HTML + CSS + JavaScript sans framework)
    js/app.js        écrans et règles métier
    js/ia.js         appels à l'IA (API Claude)
    js/cloud.js      sauvegarde chiffrée dans Supabase (bucket « saves »)
    js/db.js         stockage dans le téléphone (IndexedDB)
    js/native.js     WhatsApp Business, partage, dictée vocale Android
  android/           projet Android (Capacitor 7)
```
Essayer sur un ordinateur : `npx http-server monpressing/www -p 8081`.
