# Smart Pressing : application Android autonome

Toute la gestion du pressing dans **un seul téléphone**, sans serveur ni internet :
écran « Bienvenue / Se connecter », factures PDF, photos des pièces, circuit cousin → repassage → livraison,
vérification pièce par pièce (on coche chaque pièce), bilan par mois / 6 mois / année avec graphiques,
export du bilan en PDF ou Excel, dépenses et bénéfice net, fiches clients et fidélité, acomptes et paiements partiels,
date promise et alertes de retard, message WhatsApp « linge prêt », compte du cousin, réclamations, ticket 58 mm,
sauvegarde automatique chiffrée en ligne (Supabase), remise automatique sur grosse commande (10 % dès 5 000 F d'articles,
réglable), bilan mensuel automatique (carte le 1er du mois, copie dans Documents/SmartPressing/Bilans et notification sur Android).

Les données sont enregistrées **dans le téléphone** (base IndexedDB de l'appli).

## Obtenir l'APK
Chaque envoi sur la branche `main` déclenche GitHub Actions (onglet **Actions**), qui compile l'APK en ~5 minutes.
Le fichier `SmartPressing.apk` apparaît dans **Releases** (colonne de droite du dépôt).

## Installer sur le téléphone
1. Sur le téléphone, ouvrez la page **Releases** du dépôt et téléchargez `SmartPressing.apk`.
2. Ouvrez le fichier. Android demande d'autoriser « Installer des applis inconnues » pour Chrome / Fichiers : acceptez.
3. Ouvrez **Smart Pressing** → « Se connecter » → « Reprendre mes données » (reprend vos réglages, vos 11 articles et les factures N°19 et 20).
4. Réglages : ajoutez le logo et choisissez un **code administrateur** (protège bilan, dépenses, réglages et marges).

Les mises à jour s'installent par-dessus l'ancienne version **sans perdre les données**
(même clé de signature : `android/app/smartpressing.keystore`, ne la supprimez pas).
⚠️ Désinstaller l'appli efface les données : faites d'abord une sauvegarde.

## Version iPhone
Adresse : **https://ori10.github.io/smart-pressing-app/** (publiée automatiquement à chaque envoi sur `main`).
1. Sur l'iPhone, ouvrez cette adresse dans **Safari** (pas Chrome).
2. Bouton Partager (carré avec une flèche) → **Sur l'écran d'accueil** → Ajouter.
3. Ouvrez l'icône « Pressing » : l'appli s'ouvre en plein écran et fonctionne ensuite **sans internet**.
4. Pour reprendre les données du téléphone Android : sur Android, Plus → Sauvegarde → envoyez le fichier à l'iPhone
   (WhatsApp, AirDrop, e-mail) → enregistrez-le dans « Fichiers » ; sur l'iPhone, premier démarrage → « Restaurer une sauvegarde ».

Chaque téléphone a **sa propre base** : ce qui est saisi sur l'iPhone n'apparaît pas sur l'Android (et inversement).
N'ouvrez l'appli iPhone que depuis l'icône de l'écran d'accueil (les données de Safari et de l'icône sont séparées).

## Clients, arriérés, promotions, WhatsApp
- **Clients** (Plus → Clients) : fiche avec nom, prénom, sexe, numéro WhatsApp et ancien solde ; à la facture, liste
  déroulante, et un nom inconnu crée la fiche à l'émission. Les clients des anciennes factures sont repris automatiquement.
- **Arriéré** à la facture : l'appli propose l'ancien solde de la fiche et les restes des anciennes factures (reportés,
  donc jamais comptés deux fois) ou un montant libre. L'arriéré est hors chiffre d'affaires.
- **Prix modifiables** à la facture (✎), avec « Retenir ce prix pour ce client » : appliqué tout seul ensuite.
- **Lavage** par facture : chez le cousin ou à la maison (pas de coût, pas d'étape cousin).
- **Promotions** (Plus → Promotions, admin) : %, F ou F par pièce ; toute la commande ou certains articles ; minimum,
  dates, jours de la semaine ; automatique ou au choix.
- **Relances des impayés** : 7 jours après la livraison, puis tous les 7 jours (3 fois max), carte « Relances à faire » +
  notification Android à 10 h ; un toucher ouvre WhatsApp Business avec le message poli (un message par client).
- **WhatsApp Business** : « Monsieur/Madame NOM, vos habits sont prêts. Pouvons-nous passer ? » et, après la livraison,
  carte de remerciement en image. Sur Android, la conversation du client s'ouvre directement dans WhatsApp Business.

## Sauvegarde automatique en ligne
Plus → Sauvegarde → « Sauvegarde automatique en ligne » : le guide pas à pas est dans l'appli (compte Supabase gratuit,
dossier `sauvegardes`, code SQL à copier, adresse + clé + mot de passe). Ensuite, chaque soir à partir de 19 h, dès que
l'appli est ouverte avec internet, la sauvegarde du jour est envoyée, **chiffrée** avec votre mot de passe.
Nouveau téléphone : premier démarrage → « Restaurer depuis internet ».

## Ticket 58 mm
Facture → « Ticket 58 mm » crée un PDF au format ticket. Sur Android, installez l'appli gratuite **RawBT**
(imprimantes thermiques Bluetooth ESC/POS), puis partagez le ticket vers RawBT pour l'imprimer.

## Sauvegardes (important)
Le téléphone est la seule copie. Menu **Plus → Sauvegarde → Créer et envoyer la sauvegarde** : envoyez le fichier `.json`
sur votre WhatsApp, Google Drive ou par e-mail, **chaque semaine**. L'accueil affiche un rappel au bout de 7 jours.
Nouveau téléphone : installez l'appli → « Restaurer une sauvegarde ».

## Différences avec la version Django
- Un seul téléphone, donc plus de comptes séparés : un **code admin** remplace les rôles pour cacher l'argent aux employés.
- Pas de codes-barres ni d'étiquettes : la vérification se fait en cochant chaque pièce à l'écran.
- Factures : PDF à partager (WhatsApp) ou à imprimer depuis le lecteur PDF du téléphone.
- Bibliothèques et police embarquées : rien ne dépend d'internet.

## Structure
```
www/               l'application (HTML + CSS + JavaScript sans framework)
  js/logic.js      règles métier : facture, statuts, vérification, bilan, sauvegarde
  js/app.js        écrans
  js/pdf.js        facture A4
  js/db.js         stockage dans le téléphone (IndexedDB)
  js/seed.js       données reprises de l'ancienne base db.sqlite3
android/           projet Android (Capacitor 7)
.github/workflows  compilation automatique de l'APK
```

## Essayer sur un ordinateur
`npx http-server www -p 8080` puis ouvrez http://localhost:8080 (les données restent dans ce navigateur).

## Compiler soi-même (Android Studio)
`npm ci && npx cap sync android`, puis ouvrez le dossier `android/` dans Android Studio → Build → Build APK.
