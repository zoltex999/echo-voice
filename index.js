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
  SlashCommandBuilder,
  LabelBuilder,
  RadioGroupBuilder,
  RadioGroupOptionBuilder,
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
  forbidden: "<:forbidden:1514249533121630248>"
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

// Permission "Définir le statut du salon vocal" (bit 48), absente de PermissionFlagsBits
// dans cette version de discord.js : on la manipule donc en bitfield brut.
const SET_STATUS_BIT = 1n << 48n;

// Verrouille le statut du salon : personne (même pas le propriétaire) ne peut le
// modifier nativement via Discord, seul le bot le peut (via le bouton du panneau).
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
    obj[id] = { ownerId: d.ownerId, blacklist: [...d.blacklist], joinOrder: d.joinOrder, status: d.status ?? null };
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

// Presets par propriétaire : { [userId]: { name, status, limit, bitrate, hidden, blacklist } }
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

// Indique si le salon est caché pour @everyone (permission ViewChannel refusée).
function isHidden(channel) {
  const everyoneId = channel.guild.roles.everyone.id;
  return Boolean(channel.permissionOverwrites.cache.get(everyoneId)?.deny.has(PermissionFlagsBits.ViewChannel));
}

// Met à jour le statut du salon vocal (route REST dédiée) et mémorise la valeur.
async function setChannelStatus(channel, status, data) {
  await channel.client.rest.put(`/channels/${channel.id}/voice-status`, {
    body: { status: status || null }
  });
  if (data) {
    data.status = status || null;
    saveData();
  }
}

// Applique l'identité et la présence du bot depuis le .env.
async function applyIdentity() {
  client.user.setPresence({
    status: config.presenceStatus,
    activities: config.presenceText
      ? [{ name: config.presenceText, type: config.presenceType, state: config.presenceText }]
      : []
  });

  if (config.botName && client.user.username !== config.botName) {
    // Discord limite fortement les changements de nom : on tente sans bloquer le démarrage.
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
    tempChannels.set(channelId, { ownerId, blacklist: new Set(d.blacklist || []), joinOrder, status: d.status ?? null });
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
  } catch (e) {
    if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
      await interaction.reply({ embeds: [red("Erreur")], flags: MessageFlags.Ephemeral }).catch(() => {});
    }
  }
});

client.on("voiceStateUpdate", async (oldState, newState) => {
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
    tempChannels.set(channel.id, { ownerId: member.id, blacklist: new Set(), joinOrder: [member.id], status: null });
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

  if (oldState.channel && tempChannels.has(oldState.channel.id) && oldState.channelId !== newState.channelId) {
    const channel = oldState.channel;
    const data = tempChannels.get(channel.id);
    data.joinOrder = data.joinOrder.filter((id) => id !== oldState.id);

    if (channel.members.size === 0) {
      tempChannels.delete(channel.id);
      saveData();
      await channel.delete().catch(() => {});
      return;
    }

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

async function sendPanel(channel, owner) {
  const embed = new EmbedBuilder()
    .setColor(COLORS.blurple)
    .setTitle(`${E.settings} Panneau de contrôle`)
    .setDescription("Utilise les boutons pour gérer ton salon");

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("voc_rename").setEmoji(E.pen).setLabel("Renommer").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("voc_limit").setEmoji(E.member).setLabel("Limite").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("voc_lock").setEmoji(E.lock).setLabel("Verrouiller").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("voc_hide").setEmoji(E.compass).setLabel("Cacher").setStyle(ButtonStyle.Secondary)
  );
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("voc_blacklist").setEmoji(E.forbidden).setLabel("Blacklist").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("voc_unblacklist").setEmoji(E.check).setLabel("Unblacklist").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("voc_transfer").setEmoji(E.crown).setLabel("Transférer").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("voc_claim").setEmoji(E.voice).setLabel("Réclamer").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("voc_delete").setEmoji(E.trash).setLabel("Supprimer").setStyle(ButtonStyle.Secondary)
  );
  const row3 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("voc_bitrate").setEmoji(E.voice).setLabel("Bitrate").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("voc_kick").setEmoji(E.member).setLabel("Expulser").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("voc_mute").setEmoji(E.lock).setLabel("Mute").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("voc_status").setEmoji(E.pen).setLabel("Statut").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("voc_save").setEmoji(E.settings).setLabel("Sauvegarder").setStyle(ButtonStyle.Secondary)
  );

  await channel.send({ content: `<@${owner.id}>`, embeds: [embed], components: [row1, row2, row3] });
}

function getData(interaction) {
  return tempChannels.get(interaction.channelId);
}

function isOwner(interaction, data) {
  return data && data.ownerId === interaction.user.id;
}

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

  if (!isOwner(interaction, data)) {
    await interaction.reply({ embeds: [red("Seul le propriétaire peut faire ça")], flags: MessageFlags.Ephemeral });
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
    const channel = interaction.channel;
    const presets = loadPresets();

    if (action === "save") {
      presets[interaction.user.id] = {
        name: channel.name,
        status: data.status ?? null,
        limit: channel.userLimit,
        bitrate: channel.bitrate,
        hidden: isHidden(channel),
        blacklist: [...data.blacklist]
      };
      savePresets(presets);
      await interaction.reply({ embeds: [blurple(`${E.check} Configuration du salon sauvegardée`)], flags: MessageFlags.Ephemeral });
      return;
    }

    // action === "load"
    const preset = presets[interaction.user.id];
    if (!preset) {
      await interaction.reply({ embeds: [red("Aucune sauvegarde trouvée")], flags: MessageFlags.Ephemeral });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (preset.name) await channel.setName(preset.name).catch(() => {});
    if (typeof preset.limit === "number") await channel.setUserLimit(preset.limit).catch(() => {});
    if (typeof preset.bitrate === "number") await channel.setBitrate(preset.bitrate).catch(() => {});
    await setChannelStatus(channel, preset.status, data).catch(() => {});

    const everyone = channel.guild.roles.everyone;
    await channel.permissionOverwrites.edit(everyone, { ViewChannel: preset.hidden ? false : null }).catch(() => {});

    const target = new Set(preset.blacklist || []);
    // Retire les membres qui ne sont plus blacklist dans la sauvegarde
    for (const id of [...data.blacklist]) {
      if (!target.has(id)) {
        data.blacklist.delete(id);
        await channel.permissionOverwrites.delete(id).catch(() => {});
      }
    }
    // Applique les membres blacklist de la sauvegarde
    for (const id of target) {
      data.blacklist.add(id);
      await channel.permissionOverwrites.edit(id, { Connect: false, ViewChannel: false }).catch(() => {});
      const member = channel.members.get(id);
      if (member) await member.voice.disconnect().catch(() => {});
    }
    saveData();

    await interaction.editReply({ embeds: [blurple(`${E.check} Sauvegarde appliquée au salon`)] });
  }
}

async function handleSelect(interaction) {
  const data = getData(interaction);
  if (!data || !isOwner(interaction, data)) {
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
}

client.login(config.token);
