const {
  Client,
  GatewayIntentBits,
  ChannelType,
  PermissionFlagsBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
  RoleSelectMenuBuilder,
  StringSelectMenuBuilder,
  SlashCommandBuilder,
  LabelBuilder,
  RadioGroupBuilder,
  RadioGroupOptionBuilder,
  CheckboxGroupBuilder,
  CheckboxGroupOptionBuilder,
  ActivityType,
  MessageFlags
} = require("discord.js");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const config = {
  token: process.env.TOKEN,
  clientId: process.env.CLIENT_ID,
  presenceStatus: process.env.PRESENCE_STATUS || "online",
  presenceType: Number(process.env.PRESENCE_TYPE ?? 4),
  presenceText: process.env.PRESENCE_TEXT || "",
  botName: process.env.BOT_NAME,
  botDescription: process.env.BOT_DESCRIPTION,
  creatorChannelName: process.env.CREATOR_CHANNEL_NAME,
  creationCooldown: Number(process.env.CREATION_COOLDOWN ?? 0),
  ownerID: process.env.OWNER_ID
};

const DATA_FILE = "./data.json";
const PRESETS_FILE = "./presets.json";

const E = {
  plus: "<:plus:1514249518890090576>",
  crown: "<:crown:1514249521780228156>",
  lock: "<:lock:1514249519695396914>",
  trash: "<:trash:1514249510883426394>",
  check: "<:check:1514249509755031552>",
  pen: "<:pen:1514249507100164116>",
  member: "<:member:1514249508094087248>",
  voice: "<:sound:1514249505393086696>",
  settings: "<:settings:1514249503790727231>",
  compass: "<:compass:1514249502855401512>",
  forbidden: "<:forbidden:1514249533121630248>",
  save: "<:save:1515680620809031710>"
};

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMembers
  ]
});

const tempChannels = new Map();
const creationCooldowns = new Map();

const COLORS = { blurple: 0x5865f2, red: 0xed4245 };

const SET_STATUS_BIT = 1n << 48n;

async function enforceStatusLock(channel) {
  const everyoneId = channel.guild.roles.everyone.id;
  const botId = channel.client.user.id;

  const everyone = channel.permissionOverwrites.cache.get(everyoneId);
  const everyoneAllow = everyone ? everyone.allow.bitfield & ~SET_STATUS_BIT : 0n;
  const everyoneDeny = (everyone ? everyone.deny.bitfield : 0n) | SET_STATUS_BIT;

  const bot = channel.permissionOverwrites.cache.get(botId);
  const botAllow = (bot ? bot.allow.bitfield : 0n) | SET_STATUS_BIT;
  const botDeny = bot ? bot.deny.bitfield & ~SET_STATUS_BIT : 0n;

  await channel.client.rest.put(`/channels/${channel.id}/permissions/${everyoneId}`, {
    body: { id: everyoneId, type: 0, allow: String(everyoneAllow), deny: String(everyoneDeny) }
  }).catch(() => {});
  await channel.client.rest.put(`/channels/${channel.id}/permissions/${botId}`, {
    body: { id: botId, type: 1, allow: String(botAllow), deny: String(botDeny) }
  }).catch(() => {});
}

const MODULES_FILE = path.join(__dirname, "modules.js");
let grantOwner = async () => {};
if (fs.existsSync(MODULES_FILE)) {
  grantOwner = require(MODULES_FILE).grantOwner;
}

function blurple(description) {
  return new EmbedBuilder().setColor(COLORS.blurple).setDescription(description);
}

function red(description) {
  return new EmbedBuilder().setColor(COLORS.red).setDescription(description);
}

function saveData() {
  const obj = {};
  for (const [id, d] of tempChannels) {
    obj[id] = {
      ownerId: d.ownerId,
      blacklist: [...d.blacklist],
      whitelist: [...d.whitelist],
      trusted: [...d.trusted],
      allowedRoles: [...d.allowedRoles],
      joinOrder: d.joinOrder,
      status: d.status ?? null
    };
  }
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(obj, null, 2));
  } catch (e) {
    console.error("Échec sauvegarde data.json:", e);
  }
}

function loadData() {
  if (!fs.existsSync(DATA_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch {
    return {};
  }
}

function loadPresets() {
  if (!fs.existsSync(PRESETS_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(PRESETS_FILE, "utf8"));
  } catch {
    return {};
  }
}

function savePresets(presets) {
  try {
    fs.writeFileSync(PRESETS_FILE, JSON.stringify(presets, null, 2));
  } catch (e) {
    console.error("Échec sauvegarde presets.json:", e);
  }
}

function isHidden(channel) {
  const everyoneId = channel.guild.roles.everyone.id;
  return Boolean(channel.permissionOverwrites.cache.get(everyoneId)?.deny.has(PermissionFlagsBits.ViewChannel));
}

async function setChannelStatus(channel, status, data) {
  await channel.client.rest.put(`/channels/${channel.id}/voice-status`, {
    body: { status: status || null }
  });
  if (data) {
    data.status = status || null;
    saveData();
  }
}

async function applyIdentity() {
  client.user.setPresence({
    status: config.presenceStatus,
    activities: config.presenceText
      ? [{ name: config.presenceText, type: config.presenceType, state: config.presenceText }]
      : []
  });

  if (config.botName && client.user.username !== config.botName) {
    await client.user.setUsername(config.botName).catch((e) => console.error("Échec setUsername:", e.message));
  }

  if (config.botDescription) {
    await client.application.fetch().catch(() => {});
    if (client.application.description !== config.botDescription) {
      await client.application.edit({ description: config.botDescription }).catch((e) =>
        console.error("Échec maj description:", e.message)
      );
    }
  }
}

client.once("ready", async () => {
  console.log(`✅ Connecté en tant que ${client.user.tag}`);

  await applyIdentity();

  const saved = loadData();
  for (const [channelId, d] of Object.entries(saved)) {
    const channel = client.channels.cache.get(channelId);
    if (!channel) continue;

    if (channel.members.size === 0) {
      await channel.delete().catch(() => {});
      continue;
    }

    const joinOrder = (d.joinOrder || []).filter((id) => channel.members.has(id));
    for (const id of channel.members.keys()) {
      if (!joinOrder.includes(id)) joinOrder.push(id);
    }

    let ownerId = d.ownerId;
    if (!channel.members.has(ownerId) && joinOrder.length > 0) {
      ownerId = joinOrder[0];
      await channel.permissionOverwrites.edit(ownerId, {
        Connect: true,
        ViewChannel: true,
        ManageChannels: true,
        MoveMembers: true
      }).catch(() => {});
    }

    await grantOwner(channel);
    await enforceStatusLock(channel);
    tempChannels.set(channelId, {
      ownerId,
      blacklist: new Set(d.blacklist || []),
      whitelist: new Set(d.whitelist || []),
      trusted: new Set(d.trusted || []),
      allowedRoles: new Set(d.allowedRoles || []),
      joinOrder,
      status: d.status ?? null
    });
  }
  saveData();
  console.log(`♻️ ${tempChannels.size} salon(s) temporaire(s) rechargé(s)`);

  const cmd = new SlashCommandBuilder()
    .setName("config")
    .setDescription("Nettoie les anciens salons vocaux et installe le salon créateur")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);
  await client.application.commands.set([cmd]);
});

client.on("interactionCreate", async (interaction) => {
  try {
    if (interaction.isChatInputCommand() && interaction.commandName === "config") {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const deleted = await resetGuild(interaction.guild);
      await interaction.editReply({
        embeds: [blurple(`${E.check} Configuration réinitialisée avec succès`)]
      });
      return;
    }

    if (interaction.isButton()) await handleButton(interaction);
    if (interaction.isModalSubmit()) await handleModal(interaction);
    if (interaction.isUserSelectMenu()) await handleSelect(interaction);
    if (interaction.isRoleSelectMenu()) await handleRoleSelect(interaction);
    if (interaction.isStringSelectMenu()) await handlePanelCategory(interaction);
  } catch (e) {
    if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
      await interaction.reply({ embeds: [red("Erreur")], flags: MessageFlags.Ephemeral }).catch(() => {});
    }
  }
});

client.on("voiceStateUpdate", async (oldState, newState) => {
  if (oldState.channel && tempChannels.has(oldState.channel.id) && oldState.channelId !== newState.channelId) {
    const channel = oldState.channel;
    const data = tempChannels.get(channel.id);
    data.joinOrder = data.joinOrder.filter((id) => id !== oldState.id);

    if (channel.members.size === 0) {
      tempChannels.delete(channel.id);
      saveData();
      await channel.delete().catch(() => {});
    } else {
      if (oldState.id === data.ownerId && data.joinOrder.length > 0) {
        const newOwnerId = data.joinOrder[0];
        await channel.permissionOverwrites.delete(data.ownerId).catch(() => {});
        data.ownerId = newOwnerId;
        await channel.permissionOverwrites.edit(newOwnerId, {
          Connect: true,
          ViewChannel: true,
          ManageChannels: true,
          MoveMembers: true
        });
        await grantOwner(channel);
        await channel.send({ embeds: [blurple(`${E.crown} <@${newOwnerId}> est désormais propriétaire du salon`)] }).catch(() => {});
      }
      saveData();
    }
  }

  if (newState.channel && newState.channel.name === config.creatorChannelName) {
    const member = newState.member;

    const cooldown = (config.creationCooldown ?? 0) * 1000;
    const last = creationCooldowns.get(member.id) || 0;
    if (cooldown > 0 && Date.now() - last < cooldown) {
      const reste = Math.ceil((cooldown - (Date.now() - last)) / 1000);
      await member.voice.disconnect().catch(() => {});
      await member.send({ embeds: [red(`⏳ Attends encore ${reste}s avant de créer un nouveau salon`)] }).catch(() => {});
      return;
    }
    creationCooldowns.set(member.id, Date.now());

    const channel = await newState.guild.channels.create({
      name: ` ${member.displayName}`,
      type: ChannelType.GuildVoice,
      parent: newState.channel.parentId,
      permissionOverwrites: [
        {
          id: member.id,
          allow: [
            PermissionFlagsBits.Connect,
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.ManageChannels,
            PermissionFlagsBits.MoveMembers
          ]
        }
      ]
    });
    await grantOwner(channel);
    await enforceStatusLock(channel);
    tempChannels.set(channel.id, {
      ownerId: member.id,
      blacklist: new Set(),
      whitelist: new Set(),
      trusted: new Set(),
      allowedRoles: new Set(),
      joinOrder: [member.id],
      status: null
    });
    saveData();
    await member.voice.setChannel(channel);
    await sendPanel(channel, member);
    return;
  }

  if (newState.channel && tempChannels.has(newState.channel.id) && oldState.channelId !== newState.channelId) {
    const data = tempChannels.get(newState.channel.id);
    if (!data.joinOrder.includes(newState.id)) {
      data.joinOrder.push(newState.id);
      saveData();
    }
  }
});

async function resetGuild(guild) {
  const creatorChannels = guild.channels.cache.filter(
    (c) => c.type === ChannelType.GuildVoice && c.name === config.creatorChannelName
  );
  const creatorParentIds = new Set(creatorChannels.map((c) => c.parentId).filter(Boolean));

  let deleted = 0;

  const tempToDelete = guild.channels.cache.filter(
    (c) =>
      c.type === ChannelType.GuildVoice &&
      c.name !== config.creatorChannelName &&
      creatorParentIds.has(c.parentId)
  );
  for (const channel of tempToDelete.values()) {
    tempChannels.delete(channel.id);
    await channel.delete().catch(() => {});
    deleted++;
  }

  for (const channel of creatorChannels.values()) {
    await channel.delete().catch(() => {});
    deleted++;
  }

  for (const parentId of creatorParentIds) {
    const category = guild.channels.cache.get(parentId);
    if (category && category.children.cache.size === 0) {
      await category.delete().catch(() => {});
      deleted++;
    }
  }

  const category = await guild.channels.create({
    name: "🔊 Salons vocaux",
    type: ChannelType.GuildCategory
  });
  await grantOwner(category);
  const creator = await guild.channels.create({
    name: config.creatorChannelName,
    type: ChannelType.GuildVoice,
    parent: category.id
  });
  await grantOwner(creator);

  saveData();
  return deleted;
}

const PANEL_CATEGORIES = {
  settings: {
    label: "Paramètres",
    description: "Nom, limite, bitrate, statut",
    emoji: E.settings,
    buttons: [
      ["voc_rename", E.pen, "Renommer"],
      ["voc_limit", E.member, "Limite"],
      ["voc_bitrate", E.voice, "Bitrate"],
      ["voc_status", E.pen, "Statut"]
    ]
  },
  access: {
    label: "Accès & visibilité",
    description: "Verrou, masquage, rôles autorisés",
    emoji: E.lock,
    buttons: [
      ["voc_lock", E.lock, "Verrouiller"],
      ["voc_hide", E.compass, "Cacher"],
      ["voc_allowrole", E.crown, "Autoriser rôle"],
      ["voc_removerole", E.forbidden, "Retirer rôle"]
    ]
  },
  members: {
    label: "Membres",
    description: "Expulser, mute, black/whitelist",
    emoji: E.member,
    buttons: [
      ["voc_kick", E.member, "Expulser"],
      ["voc_mute", E.lock, "Mute"],
      ["voc_blacklist", E.forbidden, "Blacklist"],
      ["voc_unblacklist", E.check, "Unblacklist"],
      ["voc_whitelist", E.plus, "Whitelist"],
      ["voc_unwhitelist", E.compass, "Unwhitelist"]
    ]
  },
  ownership: {
    label: "Propriété",
    description: "Transfert, réclamer, co-propriétaires",
    emoji: E.crown,
    buttons: [
      ["voc_transfer", E.crown, "Transférer"],
      ["voc_claim", E.voice, "Réclamer"],
      ["voc_trust", E.crown, "Promouvoir"],
      ["voc_untrust", E.forbidden, "Rétrograder"]
    ]
  },
  channel: {
    label: "Salon",
    description: "Sauvegarde et suppression",
    emoji: E.save,
    buttons: [
      ["voc_save", E.save, "Sauvegarder"],
      ["voc_delete", E.trash, "Supprimer"]
    ]
  }
};

function parseEmoji(str) {
  const m = /^<(a)?:(\w+):(\d+)>$/.exec(str);
  return m ? { name: m[2], id: m[3], animated: Boolean(m[1]) } : { name: str };
}

function buildCategoryRows(key) {
  const cat = PANEL_CATEGORIES[key];
  if (!cat) return [];
  const rows = [];
  for (let i = 0; i < cat.buttons.length; i += 5) {
    const row = new ActionRowBuilder().addComponents(
      cat.buttons.slice(i, i + 5).map(([id, emoji, label]) =>
        new ButtonBuilder()
          .setCustomId(id)
          .setEmoji(emoji)
          .setLabel(label)
          .setStyle(id === "voc_delete" ? ButtonStyle.Danger : ButtonStyle.Secondary)
      )
    );
    rows.push(row);
  }
  return rows;
}

async function sendPanel(channel, owner) {
  const embed = new EmbedBuilder()
    .setColor(COLORS.blurple)
    .setTitle(`${E.settings} Panneau de contrôle`)
    .setDescription("Choisis une catégorie dans le menu pour afficher ses actions.");

  const menu = new StringSelectMenuBuilder()
    .setCustomId("voc_panel_category")
    .setPlaceholder("Choisir une catégorie…")
    .addOptions(
      Object.entries(PANEL_CATEGORIES).map(([value, cat]) => ({
        label: cat.label,
        description: cat.description,
        value,
        emoji: parseEmoji(cat.emoji)
      }))
    );

  await channel.send({
    content: `<@${owner.id}>`,
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(menu)]
  });
}

function getData(interaction) {
  return tempChannels.get(interaction.channelId);
}

function isOwner(interaction, data) {
  return data && data.ownerId === interaction.user.id;
}

function isTrusted(data, userId) {
  return Boolean(data && data.trusted && data.trusted.has(userId));
}

function canModerate(interaction, data) {
  return isOwner(interaction, data) || isTrusted(data, interaction.user.id);
}

const MODERATE_BUTTONS = ["voc_kick", "voc_mute"];
const MODERATE_SELECTS = ["voc_select_kick", "voc_select_mute"];

async function handleButton(interaction) {
  const data = getData(interaction);
  if (!data) {
    await interaction.reply({ embeds: [red("Ce salon n'est pas un salon temporaire")], flags: MessageFlags.Ephemeral });
    return;
  }

  if (interaction.customId === "voc_claim") {
    const ownerIn = interaction.channel.members.has(data.ownerId);
    if (ownerIn) {
      await interaction.reply({ embeds: [red("Le propriétaire est encore là")], flags: MessageFlags.Ephemeral });
      return;
    }
    if (!interaction.channel.members.has(interaction.user.id)) {
      await interaction.reply({ embeds: [red("Tu dois être dans le salon")], flags: MessageFlags.Ephemeral });
      return;
    }
    data.ownerId = interaction.user.id;
    saveData();
    await interaction.channel.permissionOverwrites.edit(interaction.user.id, {
      Connect: true,
      ViewChannel: true,
      ManageChannels: true,
      MoveMembers: true
    });
    await interaction.reply({ embeds: [blurple(`${E.crown} <@${interaction.user.id}> est le nouveau propriétaire`)] });
    return;
  }

  const buttonAllowed = MODERATE_BUTTONS.includes(interaction.customId)
    ? canModerate(interaction, data)
    : isOwner(interaction, data);
  if (!buttonAllowed) {
    await interaction.reply({ embeds: [red("Tu n'as pas la permission de faire ça")], flags: MessageFlags.Ephemeral });
    return;
  }

  switch (interaction.customId) {
    case "voc_rename": {
      const modal = new ModalBuilder()
        .setCustomId("voc_modal_rename")
        .setTitle("Renommer le salon")
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId("name")
              .setLabel("Nouveau nom")
              .setStyle(TextInputStyle.Short)
              .setMaxLength(100)
              .setRequired(true)
          )
        );
      await interaction.showModal(modal);
      break;
    }
    case "voc_status": {
      const modal = new ModalBuilder()
        .setCustomId("voc_modal_status")
        .setTitle("Statut du salon")
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId("status")
              .setLabel("Nouveau statut (vide pour effacer)")
              .setStyle(TextInputStyle.Short)
              .setMaxLength(500)
              .setRequired(false)
          )
        );
      await interaction.showModal(modal);
      break;
    }
    case "voc_save": {
      const radio = new RadioGroupBuilder()
        .setCustomId("action")
        .setRequired(true)
        .addOptions(
          new RadioGroupOptionBuilder()
            .setLabel("Sauvegarder")
            .setValue("save")
            .setDescription("Enregistrer la config actuelle du salon"),
          new RadioGroupOptionBuilder()
            .setLabel("Load")
            .setValue("load")
            .setDescription("Appliquer ta sauvegarde à ce salon")
        );
      const label = new LabelBuilder()
        .setLabel("Sauvegarde")
        .setDescription("Choisis une action")
        .setRadioGroupComponent(radio);
      const modal = new ModalBuilder()
        .setCustomId("voc_modal_save")
        .setTitle("Sauvegarde du salon")
        .setLabelComponents(label);
      await interaction.showModal(modal);
      break;
    }
    case "voc_save_options": {
      const checkboxes = new CheckboxGroupBuilder()
        .setCustomId("fields")
        .setMinValues(1)
        .addOptions(
          new CheckboxGroupOptionBuilder().setLabel("Nom").setValue("name").setDefault(true),
          new CheckboxGroupOptionBuilder().setLabel("Statut").setValue("status").setDefault(true),
          new CheckboxGroupOptionBuilder().setLabel("Limite de membres").setValue("limit").setDefault(true),
          new CheckboxGroupOptionBuilder().setLabel("Bitrate").setValue("bitrate").setDefault(true),
          new CheckboxGroupOptionBuilder().setLabel("Visibilité").setValue("hidden").setDefault(true),
          new CheckboxGroupOptionBuilder().setLabel("Blacklist").setValue("blacklist").setDefault(true)
        );
      const label = new LabelBuilder()
        .setLabel("Éléments à sauvegarder")
        .setDescription("Coche ce que tu veux inclure")
        .setCheckboxGroupComponent(checkboxes);
      const modal = new ModalBuilder()
        .setCustomId("voc_modal_save_fields")
        .setTitle("Options de sauvegarde")
        .setLabelComponents(label);
      await interaction.showModal(modal);
      break;
    }
    case "voc_limit": {
      const modal = new ModalBuilder()
        .setCustomId("voc_modal_limit")
        .setTitle("Limite de membres")
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId("limit")
              .setLabel("Limite (0 = illimité, max 99)")
              .setStyle(TextInputStyle.Short)
              .setMaxLength(2)
              .setRequired(true)
          )
        );
      await interaction.showModal(modal);
      break;
    }
    case "voc_lock": {
      const everyone = interaction.guild.roles.everyone;
      const locked = interaction.channel.permissionOverwrites.cache.get(everyone.id)?.deny.has(PermissionFlagsBits.Connect);
      await interaction.channel.permissionOverwrites.edit(everyone, { Connect: locked ? null : false });
      await interaction.reply({ embeds: [blurple(locked ? `${E.check} Salon déverrouillé` : `${E.lock} Salon verrouillé`)], flags: MessageFlags.Ephemeral });
      break;
    }
    case "voc_hide": {
      const everyone = interaction.guild.roles.everyone;
      const hidden = interaction.channel.permissionOverwrites.cache.get(everyone.id)?.deny.has(PermissionFlagsBits.ViewChannel);
      await interaction.channel.permissionOverwrites.edit(everyone, { ViewChannel: hidden ? null : false });
      await interaction.reply({ embeds: [blurple(hidden ? `${E.compass} Salon visible` : `${E.compass} Salon caché`)], flags: MessageFlags.Ephemeral });
      break;
    }
    case "voc_blacklist": {
      const row = new ActionRowBuilder().addComponents(
        new UserSelectMenuBuilder().setCustomId("voc_select_blacklist").setPlaceholder("Choisis un membre à blacklist").setMaxValues(1)
      );
      await interaction.reply({ components: [row], flags: MessageFlags.Ephemeral });
      break;
    }
    case "voc_unblacklist": {
      const row = new ActionRowBuilder().addComponents(
        new UserSelectMenuBuilder().setCustomId("voc_select_unblacklist").setPlaceholder("Choisis un membre à débannir").setMaxValues(1)
      );
      await interaction.reply({ components: [row], flags: MessageFlags.Ephemeral });
      break;
    }
    case "voc_transfer": {
      const row = new ActionRowBuilder().addComponents(
        new UserSelectMenuBuilder().setCustomId("voc_select_transfer").setPlaceholder("Choisis le nouveau propriétaire").setMaxValues(1)
      );
      await interaction.reply({ components: [row], flags: MessageFlags.Ephemeral });
      break;
    }
    case "voc_delete": {
      tempChannels.delete(interaction.channelId);
      saveData();
      await interaction.channel.delete();
      break;
    }
    case "voc_bitrate": {
      const max = interaction.guild.maximumBitrate;
      const current = interaction.channel.bitrate;
      const paliers = [8000, 64000, 96000, 128000, 256000, 384000].filter((b) => b <= max);
      const options = paliers.map((b) =>
        new RadioGroupOptionBuilder()
          .setLabel(`${b / 1000} kbps`)
          .setValue(String(b))
          .setDefault(b === current)
      );
      const radio = new RadioGroupBuilder()
        .setCustomId("bitrate")
        .setRequired(true)
        .addOptions(options);
      const label = new LabelBuilder()
        .setLabel("Qualité audio")
        .setDescription("Choisis le bitrate du salon")
        .setRadioGroupComponent(radio);
      const modal = new ModalBuilder()
        .setCustomId("voc_modal_bitrate")
        .setTitle("Bitrate")
        .setLabelComponents(label);
      await interaction.showModal(modal);
      break;
    }
    case "voc_kick": {
      const row = new ActionRowBuilder().addComponents(
        new UserSelectMenuBuilder().setCustomId("voc_select_kick").setPlaceholder("Choisis un membre à expulser").setMaxValues(1)
      );
      await interaction.reply({ components: [row], flags: MessageFlags.Ephemeral });
      break;
    }
    case "voc_mute": {
      const row = new ActionRowBuilder().addComponents(
        new UserSelectMenuBuilder().setCustomId("voc_select_mute").setPlaceholder("Choisis un membre à mute / unmute").setMaxValues(1)
      );
      await interaction.reply({ components: [row], flags: MessageFlags.Ephemeral });
      break;
    }
    case "voc_whitelist": {
      const row = new ActionRowBuilder().addComponents(
        new UserSelectMenuBuilder().setCustomId("voc_select_whitelist").setPlaceholder("Choisis un membre à autoriser").setMaxValues(1)
      );
      await interaction.reply({ components: [row], flags: MessageFlags.Ephemeral });
      break;
    }
    case "voc_unwhitelist": {
      const row = new ActionRowBuilder().addComponents(
        new UserSelectMenuBuilder().setCustomId("voc_select_unwhitelist").setPlaceholder("Choisis un membre à retirer").setMaxValues(1)
      );
      await interaction.reply({ components: [row], flags: MessageFlags.Ephemeral });
      break;
    }
    case "voc_trust": {
      const row = new ActionRowBuilder().addComponents(
        new UserSelectMenuBuilder().setCustomId("voc_select_trust").setPlaceholder("Choisis un co-propriétaire").setMaxValues(1)
      );
      await interaction.reply({ components: [row], flags: MessageFlags.Ephemeral });
      break;
    }
    case "voc_untrust": {
      const row = new ActionRowBuilder().addComponents(
        new UserSelectMenuBuilder().setCustomId("voc_select_untrust").setPlaceholder("Choisis un co-propriétaire à retirer").setMaxValues(1)
      );
      await interaction.reply({ components: [row], flags: MessageFlags.Ephemeral });
      break;
    }
    case "voc_allowrole": {
      const row = new ActionRowBuilder().addComponents(
        new RoleSelectMenuBuilder().setCustomId("voc_select_allowrole").setPlaceholder("Choisis un rôle à autoriser").setMaxValues(1)
      );
      await interaction.reply({ components: [row], flags: MessageFlags.Ephemeral });
      break;
    }
    case "voc_removerole": {
      const row = new ActionRowBuilder().addComponents(
        new RoleSelectMenuBuilder().setCustomId("voc_select_removerole").setPlaceholder("Choisis un rôle à retirer").setMaxValues(1)
      );
      await interaction.reply({ components: [row], flags: MessageFlags.Ephemeral });
      break;
    }
  }
}

async function handleModal(interaction) {
  const data = getData(interaction);
  if (!data || !isOwner(interaction, data)) {
    await interaction.reply({ embeds: [red("Action refusée")], flags: MessageFlags.Ephemeral });
    return;
  }

  if (interaction.customId === "voc_modal_rename") {
    const name = interaction.fields.getTextInputValue("name");
    await interaction.channel.setName(name);
    await interaction.reply({ embeds: [blurple(`${E.pen} Salon renommé en **${name}**`)], flags: MessageFlags.Ephemeral });
  }

  if (interaction.customId === "voc_modal_status") {
    const status = interaction.fields.getTextInputValue("status").trim();
    await setChannelStatus(interaction.channel, status, data);
    await interaction.reply({
      embeds: [blurple(status ? `${E.pen} Statut mis à jour : **${status}**` : `${E.pen} Statut effacé`)],
      flags: MessageFlags.Ephemeral
    });
  }

  if (interaction.customId === "voc_modal_limit") {
    const limit = parseInt(interaction.fields.getTextInputValue("limit"), 10);
    if (isNaN(limit) || limit < 0 || limit > 99) {
      await interaction.reply({ embeds: [red("Limite invalide (0-99)")], flags: MessageFlags.Ephemeral });
      return;
    }
    await interaction.channel.setUserLimit(limit);
    await interaction.reply({ embeds: [blurple(`${E.member} Limite fixée à **${limit === 0 ? "illimité" : limit}**`)], flags: MessageFlags.Ephemeral });
  }

  if (interaction.customId === "voc_modal_bitrate") {
    const value = parseInt(interaction.fields.getRadioGroup("bitrate"), 10);
    if (isNaN(value)) {
      await interaction.reply({ embeds: [red("Bitrate invalide")], flags: MessageFlags.Ephemeral });
      return;
    }
    await interaction.channel.setBitrate(value).catch(() => {});
    await interaction.reply({ embeds: [blurple(`${E.voice} Bitrate réglé sur **${value / 1000} kbps**`)], flags: MessageFlags.Ephemeral });
  }

  if (interaction.customId === "voc_modal_save") {
    const action = interaction.fields.getRadioGroup("action");

    if (action === "save") {
      const embed = new EmbedBuilder()
        .setColor(COLORS.blurple)
        .setTitle(`${E.settings} Configuration supplémentaire nécessaire`)
        .setDescription("Choisis les éléments du salon à inclure dans ta sauvegarde.");
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("voc_save_options").setEmoji(E.save).setLabel("Choisir les options").setStyle(ButtonStyle.Primary)
      );
      await interaction.reply({ embeds: [embed], components: [row], flags: MessageFlags.Ephemeral });
      return;
    }

    const channel = interaction.channel;
    const preset = loadPresets()[interaction.user.id];
    if (!preset) {
      await interaction.reply({ embeds: [red("Aucune sauvegarde trouvée")], flags: MessageFlags.Ephemeral });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if ("name" in preset && preset.name) await channel.setName(preset.name).catch(() => {});
    if ("limit" in preset && typeof preset.limit === "number") await channel.setUserLimit(preset.limit).catch(() => {});
    if ("bitrate" in preset && typeof preset.bitrate === "number") await channel.setBitrate(preset.bitrate).catch(() => {});
    if ("status" in preset) await setChannelStatus(channel, preset.status, data).catch(() => {});

    if ("hidden" in preset) {
      const everyone = channel.guild.roles.everyone;
      await channel.permissionOverwrites.edit(everyone, { ViewChannel: preset.hidden ? false : null }).catch(() => {});
    }

    if ("blacklist" in preset && Array.isArray(preset.blacklist)) {
      const target = new Set(preset.blacklist);
      for (const id of [...data.blacklist]) {
        if (!target.has(id)) {
          data.blacklist.delete(id);
          await channel.permissionOverwrites.delete(id).catch(() => {});
        }
      }
      for (const id of target) {
        data.blacklist.add(id);
        await channel.permissionOverwrites.edit(id, { Connect: false, ViewChannel: false }).catch(() => {});
        const member = channel.members.get(id);
        if (member) await member.voice.disconnect().catch(() => {});
      }
      saveData();
    }

    await interaction.editReply({ embeds: [blurple(`${E.check} Sauvegarde appliquée au salon`)] });
  }

  if (interaction.customId === "voc_modal_save_fields") {
    const fields = interaction.fields.getCheckboxGroup("fields");
    const channel = interaction.channel;
    const presets = loadPresets();
    const preset = {};

    if (fields.includes("name")) preset.name = channel.name;
    if (fields.includes("status")) preset.status = data.status ?? null;
    if (fields.includes("limit")) preset.limit = channel.userLimit;
    if (fields.includes("bitrate")) preset.bitrate = channel.bitrate;
    if (fields.includes("hidden")) preset.hidden = isHidden(channel);
    if (fields.includes("blacklist")) preset.blacklist = [...data.blacklist];

    presets[interaction.user.id] = preset;
    savePresets(presets);
    await interaction.reply({
      embeds: [blurple(`${E.check} Sauvegarde enregistrée (${fields.length} élément(s))`)],
      flags: MessageFlags.Ephemeral
    });
  }
}

async function handleSelect(interaction) {
  const data = getData(interaction);
  const selectAllowed = MODERATE_SELECTS.includes(interaction.customId)
    ? canModerate(interaction, data)
    : isOwner(interaction, data);
  if (!data || !selectAllowed) {
    await interaction.reply({ embeds: [red("Action refusée")], flags: MessageFlags.Ephemeral });
    return;
  }
  const targetId = interaction.values[0];

  if (interaction.customId === "voc_select_blacklist") {
    if (targetId === data.ownerId) {
      await interaction.update({ embeds: [red("Tu ne peux pas te blacklist toi-même")], components: [] });
      return;
    }
    data.blacklist.add(targetId);
    saveData();
    await interaction.channel.permissionOverwrites.edit(targetId, { Connect: false, ViewChannel: false });
    const member = interaction.channel.members.get(targetId);
    if (member) await member.voice.disconnect().catch(() => {});
    await interaction.update({ embeds: [blurple(`${E.forbidden} <@${targetId}> blacklist`)], components: [] });
  }

  if (interaction.customId === "voc_select_unblacklist") {
    data.blacklist.delete(targetId);
    saveData();
    await interaction.channel.permissionOverwrites.delete(targetId).catch(() => {});
    await interaction.update({ embeds: [blurple(`${E.check} <@${targetId}> retiré de la blacklist`)], components: [] });
  }

  if (interaction.customId === "voc_select_transfer") {
    if (!interaction.channel.members.has(targetId)) {
      await interaction.update({ embeds: [red("Le membre doit être dans le salon")], components: [] });
      return;
    }
    await interaction.channel.permissionOverwrites.delete(data.ownerId).catch(() => {});
    data.ownerId = targetId;
    saveData();
    await interaction.channel.permissionOverwrites.edit(targetId, {
      Connect: true,
      ViewChannel: true,
      ManageChannels: true,
      MoveMembers: true
    });
    await grantOwner(interaction.channel);
    await interaction.update({ embeds: [blurple(`${E.crown} Propriété transférée à <@${targetId}>`)], components: [] });
  }

  if (interaction.customId === "voc_select_kick") {
    if (targetId === data.ownerId) {
      await interaction.update({ embeds: [red("Tu ne peux pas t'expulser toi-même")], components: [] });
      return;
    }
    const member = interaction.channel.members.get(targetId);
    if (!member) {
      await interaction.update({ embeds: [red("Ce membre n'est pas dans le salon")], components: [] });
      return;
    }
    await member.voice.disconnect().catch(() => {});
    await interaction.update({ embeds: [blurple(`${E.member} <@${targetId}> a été expulsé du salon`)], components: [] });
  }

  if (interaction.customId === "voc_select_mute") {
    const member = interaction.channel.members.get(targetId);
    if (!member) {
      await interaction.update({ embeds: [red("Ce membre n'est pas dans le salon")], components: [] });
      return;
    }
    const mute = !member.voice.serverMute;
    await member.voice.setMute(mute, "Salon temporaire").catch(() => {});
    await interaction.update({
      embeds: [blurple(mute ? `🔇 <@${targetId}> a été rendu muet` : `🔊 <@${targetId}> n'est plus muet`)],
      components: []
    });
  }

  if (interaction.customId === "voc_select_whitelist") {
    data.whitelist.add(targetId);
    data.blacklist.delete(targetId);
    saveData();
    await interaction.channel.permissionOverwrites.edit(targetId, { Connect: true, ViewChannel: true });
    await interaction.update({ embeds: [blurple(`${E.check} <@${targetId}> autorisé à rejoindre le salon`)], components: [] });
  }

  if (interaction.customId === "voc_select_unwhitelist") {
    data.whitelist.delete(targetId);
    saveData();
    await interaction.channel.permissionOverwrites.delete(targetId).catch(() => {});
    await interaction.update({ embeds: [blurple(`${E.forbidden} <@${targetId}> retiré de la whitelist`)], components: [] });
  }

  if (interaction.customId === "voc_select_trust") {
    if (targetId === data.ownerId) {
      await interaction.update({ embeds: [red("Tu es déjà propriétaire")], components: [] });
      return;
    }
    data.trusted.add(targetId);
    saveData();
    await interaction.update({ embeds: [blurple(`${E.crown} <@${targetId}> est désormais co-propriétaire (expulser / mute)`)], components: [] });
  }

  if (interaction.customId === "voc_select_untrust") {
    data.trusted.delete(targetId);
    saveData();
    await interaction.update({ embeds: [blurple(`${E.forbidden} <@${targetId}> n'est plus co-propriétaire`)], components: [] });
  }
}

async function handleRoleSelect(interaction) {
  const data = getData(interaction);
  if (!data || !isOwner(interaction, data)) {
    await interaction.reply({ embeds: [red("Action refusée")], flags: MessageFlags.Ephemeral });
    return;
  }
  const roleId = interaction.values[0];

  if (interaction.customId === "voc_select_allowrole") {
    data.allowedRoles.add(roleId);
    saveData();
    await interaction.channel.permissionOverwrites.edit(roleId, { Connect: true, ViewChannel: true });
    await interaction.update({ embeds: [blurple(`${E.check} Le rôle <@&${roleId}> peut rejoindre le salon`)], components: [] });
  }

  if (interaction.customId === "voc_select_removerole") {
    data.allowedRoles.delete(roleId);
    saveData();
    await interaction.channel.permissionOverwrites.delete(roleId).catch(() => {});
    await interaction.update({ embeds: [blurple(`${E.forbidden} Rôle <@&${roleId}> retiré des autorisations`)], components: [] });
  }
}

async function handlePanelCategory(interaction) {
  if (interaction.customId !== "voc_panel_category") return;
  const data = getData(interaction);
  if (!data) {
    await interaction.reply({ embeds: [red("Ce salon n'est pas un salon temporaire")], flags: MessageFlags.Ephemeral });
    return;
  }
  const key = interaction.values[0];
  const cat = PANEL_CATEGORIES[key];
  if (!cat) {
    await interaction.reply({ embeds: [red("Catégorie inconnue")], flags: MessageFlags.Ephemeral });
    return;
  }
  const embed = new EmbedBuilder()
    .setColor(COLORS.blurple)
    .setTitle(`${cat.emoji} ${cat.label}`)
    .setDescription(cat.description);
  await interaction.reply({ embeds: [embed], components: buildCategoryRows(key), flags: MessageFlags.Ephemeral });
}

client.login(config.token);
