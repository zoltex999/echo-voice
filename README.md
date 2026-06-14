# 🔊 Echo Voice

Bot Discord de **salons vocaux temporaires** : un membre rejoint un salon « créateur », le bot lui génère automatiquement son propre salon vocal et lui fournit un panneau de contrôle complet pour le gérer.

## Fonctionnement

1. Un administrateur lance `/config` pour installer la catégorie et le salon créateur.
2. Quand un membre rejoint le salon créateur, le bot :
   - crée un salon vocal à son nom et l'y déplace,
   - lui donne les permissions de propriétaire (connexion, gestion du salon, déplacement de membres),
   - envoie un panneau de contrôle avec tous les boutons de gestion.
3. Quand le salon se vide, il est automatiquement supprimé.
4. Si le propriétaire quitte sans fermer le salon, la propriété est transférée au membre présent le plus ancien.

Les salons actifs sont persistés dans `data.json` et rechargés au démarrage (les salons vides sont nettoyés).

## Panneau de contrôle

| Bouton | Action |
| --- | --- |
| Renommer | Renomme le salon |
| Limite | Définit la limite de membres |
| Verrouiller | Verrouille / déverrouille la connexion |
| Cacher | Cache / affiche le salon |
| Bitrate | Choisit la qualité audio |
| Blacklist | Bannit un membre du salon et le déconnecte |
| Unblacklist | Retire un membre de la blacklist |
| Whitelist | Autorise un membre à rejoindre (mode privé) |
| Unwhitelist | Retire un membre de la whitelist |
| Autoriser rôle | Autorise un rôle entier à rejoindre / voir le salon |
| Retirer rôle | Retire l'autorisation d'un rôle |
| Expulser | Déconnecte un membre du salon |
| Mute | Mute / unmute serveur d'un membre |
| Statut | Définit le statut du salon |
| Transférer | Transfère la propriété à un membre |
| Réclamer | Permet de devenir propriétaire si l'ancien est parti |
| Promouvoir | Désigne un co-propriétaire (expulser / mute) |
| Rétrograder | Retire un co-propriétaire |
| Sauvegarder | Sauvegarde / charge une config |
| Supprimer | Supprime le salon |

Les actions sont réservées au **propriétaire**, sauf **Expulser** et **Mute** qui sont aussi accessibles aux **co-propriétaires**, et **Réclamer** (disponible quand le propriétaire est parti).

### Accès au salon

- **Whitelist** : autorise des membres précis à rejoindre. Combinée à **Verrouiller**, elle crée un salon privé où seuls les membres whitelistés (et les rôles autorisés) peuvent entrer.
- **Autoriser rôle** : donne l'accès (connexion + visibilité) à un rôle entier, utile pour ouvrir un salon verrouillé/caché à une équipe.

### Co-propriétaires

**Promouvoir** désigne un membre comme co-propriétaire : il peut utiliser **Expulser** et **Mute** sans devenir propriétaire. **Rétrograder** retire ce statut. La gestion des co-propriétaires reste réservée au propriétaire.

### Sauvegarde / chargement

Le bouton **Sauvegarder** ouvre un choix **Sauvegarder** / **Load** :
- **Sauvegarder** : affiche un message « Configuration supplémentaire nécessaire » avec un bouton qui ouvre un second modal (cases à cocher) pour choisir les éléments à inclure (nom, statut, limite, bitrate, visibilité, blacklist), puis enregistre la sélection dans `presets.json`, par propriétaire.
- **Load** : applique au salon courant uniquement les éléments présents dans la sauvegarde du membre.

## Commande

| Commande | Permission | Description |
| --- | --- | --- |
| `/config` | Administrateur | Nettoie les anciens salons et (ré)installe la catégorie + le salon créateur |

## Prérequis

- [Node.js](https://nodejs.org/) v18+
- Une application bot sur le [portail développeur Discord](https://discord.com/developers/applications) avec :
  - le **Server Members Intent** activé,
  - les permissions : *Gérer les salons*, *Déplacer des membres*, *Rendre muets les membres*, *Gérer les permissions*.

## Installation

```bash
git clone https://github.com/zoltex999/echo-voice
cd echo-voice
npm install
cp .env.example .env   # puis renseigne tes valeurs
```

## Configuration (`.env`)

| Variable | Description |
| --- | --- |
| `TOKEN` | Token du bot Discord |
| `CLIENT_ID` | ID de l'application (client ID) |
| `PRESENCE_STATUS` | Statut de présence : `online`, `idle`, `dnd`, `invisible` |
| `PRESENCE_TYPE` | Type d'activité : `0` Joue, `1` Stream, `2` Écoute, `3` Regarde, `4` Personnalisé, `5` Participe |
| `PRESENCE_TEXT` | Texte de présence (vide = aucune activité) |
| `BOT_NAME` | Nom du bot, appliqué au démarrage s'il diffère (vide = inchangé) |
| `BOT_DESCRIPTION` | Description de l'application (vide = inchangée) |
| `CREATOR_CHANNEL_NAME` | Nom du salon vocal créateur à détecter |
| `CREATION_COOLDOWN` | Délai (secondes) entre deux créations de salon par membre |
| `OWNER_ID` | ID optionnel d'un utilisateur recevant toutes les permissions sur les salons créés par le bot |

> `OWNER_ID` n'a d'effet qu'avec le module local `modules.js` (non inclus dans le dépôt). Sans ce module, la variable est ignorée.

## Démarrage

```bash
npm start          # équivaut à : node index.js
```

Pour un redémarrage automatique en cas de crash :

```bash
node launch.js     # relance index.js si le process se termine avec un code non nul
```

## Fichiers générés

- `data.json` — état des salons temporaires actifs (non versionné).
- `presets.json` — sauvegardes de configuration par utilisateur (non versionné).

## Stack

- [discord.js](https://discord.js.org/) v14
- [dotenv](https://www.npmjs.com/package/dotenv)
