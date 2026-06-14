# 🔊 Echo Voice

Bot Discord de **salons vocaux temporaires**

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
| Whitelist | Autorise un membre à rejoindre |
| Unwhitelist | Retire un membre de la whitelist |
| Autoriser rôle | Autorise un rôle entier à rejoindre / voir le salon |
| Retirer rôle | Retire l'autorisation d'un rôle |
| Expulser | Déconnecte un membre du salon |
| Mute | Mute / unmute serveur d'un membre |
| Statut | Définit le statut du salon |
| Transférer | Transfère la propriété à un membre |
| Réclamer | Permet de devenir propriétaire si l'ancien est parti |
| Promouvoir | Désigne un co-propriétaire |
| Rétrograder | Retire un co-propriétaire |
| Sauvegarder | Sauvegarde / charge une config |
| Supprimer | Supprime le salon |

Les actions sont réservées au **propriétaire**, sauf **Expulser** et **Mute** qui sont aussi accessibles aux **co-propriétaires**, et **Réclamer**

## Commande

| Commande | Permission | Description |
| --- | --- | --- |
| `/config` | Administrateur | Installe le système |

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
cp .env.example .env
```

## Configuration `.env`

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

## Démarrage

```bash
node launch.js
```

## Fichiers générés

- `data.json` — état des salons temporaires actifs
- `presets.json` — sauvegardes de configuration par utilisateur

## Stack

- [discord.js](https://discord.js.org/) v14
- [dotenv](https://www.npmjs.com/package/dotenv)

---

## Support

Supporte le développeur et le bot en faisant un petit don 

### [ko-fi.com/zoltex999](https://ko-fi.com/zoltex99)


## A propos

Crée et développé par zoltex999, 
Tous droits réservés
