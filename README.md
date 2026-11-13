# Smart Pressing : application Android autonome

Toute la gestion du pressing dans **un seul téléphone**, sans serveur ni internet :
factures PDF, étiquettes à code-barres, photos des pièces, circuit cousin → repassage → livraison,
vérification par scan (caméra, lecteur Bluetooth ou saisie), bilan, dépenses et bénéfice net.

Les données sont enregistrées **dans le téléphone** (base IndexedDB de l'appli).

## Obtenir l'APK
Chaque envoi sur la branche `main` déclenche GitHub Actions (onglet **Actions**), qui compile l'APK en ~5 minutes.
Le fichier `SmartPressing.apk` apparaît dans **Releases** (colonne de droite du dépôt).

## Installer sur le téléphone
1. Sur le téléphone, ouvrez la page **Releases** du dépôt et téléchargez `SmartPressing.apk`.
2. Ouvrez le fichier. Android demande d'autoriser « Installer des applis inconnues » pour Chrome / Fichiers : acceptez.
3. Ouvrez **Smart Pressing** → « Reprendre mes données » (reprend vos réglages, vos 11 articles et les factures N°19 et 20).
4. Réglages : ajoutez le logo et choisissez un **code administrateur** (protège bilan, dépenses, réglages et marges).

Les mises à jour s'installent par-dessus l'ancienne version **sans perdre les données**
(même clé de signature : `android/app/smartpressing.keystore`, ne la supprimez pas).
⚠️ Désinstaller l'appli efface les données : faites d'abord une sauvegarde.

## Sauvegardes (important)
Le téléphone est la seule copie. Menu **Plus → Sauvegarde → Créer et envoyer la sauvegarde** : envoyez le fichier `.json`
sur votre WhatsApp, Google Drive ou par e-mail, **chaque semaine**. L'accueil affiche un rappel au bout de 7 jours.
Nouveau téléphone : installez l'appli → « Restaurer une sauvegarde ».

## Différences avec la version Django
- Un seul téléphone, donc plus de comptes séparés : un **code admin** remplace les rôles pour cacher l'argent aux employés.
- Étiquettes et factures : PDF à partager (WhatsApp) ou à imprimer depuis le lecteur PDF du téléphone.
- Bibliothèques (PDF, codes-barres, scan) et police embarquées : rien ne dépend d'internet.

## Structure
```
www/               l'application (HTML + CSS + JavaScript sans framework)
  js/logic.js      règles métier : facture, statuts, scan, bilan, sauvegarde
  js/app.js        écrans
  js/pdf.js        facture A4 et planche d'étiquettes (3 colonnes)
  js/db.js         stockage dans le téléphone (IndexedDB)
  js/seed.js       données reprises de l'ancienne base db.sqlite3
android/           projet Android (Capacitor 7)
.github/workflows  compilation automatique de l'APK
```

## Essayer sur un ordinateur
`npx http-server www -p 8080` puis ouvrez http://localhost:8080 (les données restent dans ce navigateur).

## Compiler soi-même (Android Studio)
`npm ci && npx cap sync android`, puis ouvrez le dossier `android/` dans Android Studio → Build → Build APK.
