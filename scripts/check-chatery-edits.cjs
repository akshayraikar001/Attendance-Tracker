const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const path = require("node:path");
const root = process.argv[2];
if (!root) throw new Error("Pass the configured Chatery folder.");
const Store = require(path.join(root, "src/services/whatsapp/BaileysStore.js"));
const Formatter = require(
  path.join(root, "src/services/whatsapp/MessageFormatter.js"),
);
const store = new Store(),
  ev = new EventEmitter();
store.bind(ev);
const original = {
  key: { id: "one", remoteJid: "test@g.us", participant: "123@s.whatsapp.net" },
  messageTimestamp: 100,
  message: { conversation: "IN 09:00" },
};
ev.emit("messages.upsert", { messages: [original] });
const edit = {
  message: { editedMessage: { message: { conversation: "IN 09:30" } } },
  messageTimestamp: 200,
};
ev.emit("messages.update", [{ key: original.key, update: edit }]);
ev.emit("messaging-history.set", { messages: [original] });
let result = Formatter.formatMessage(store.getMessage("test@g.us", "one"));
assert.equal(result.content, "IN 09:30");
assert.equal(result.timestamp, 100);
assert.equal(result.isEdited, true);
ev.emit("messages.upsert", { messages: [original] });
assert.equal(
  Formatter.formatMessage(store.getMessage("test@g.us", "one")).content,
  "IN 09:30",
);
const second = { ...original, key: { ...original.key, id: "two" } };
ev.emit("messages.update", [{ key: second.key, update: edit }]);
ev.emit("messaging-history.set", { messages: [second] });
result = Formatter.formatMessage(store.getMessage("test@g.us", "two"));
assert.equal(result.content, "IN 09:30");
assert.equal(result.timestamp, 100);
console.log(
  "PASS: edited text survives history/upsert replay and edits arriving before original history.",
);

const protocol = {
  key: { ...original.key, id: "edit-envelope" },
  messageTimestamp: 300,
  message: {
    protocolMessage: {
      key: original.key,
      timestampMs: 300000,
      editedMessage: { conversation: "IN 10:00" },
    },
  },
};
ev.emit("messages.upsert", { messages: [protocol] });
assert.equal(
  Formatter.formatMessage(store.getMessage("test@g.us", "one")).content,
  "IN 10:00",
);
ev.emit("messaging-history.set", { messages: [original] });
assert.equal(
  Formatter.formatMessage(store.getMessage("test@g.us", "one")).content,
  "IN 10:00",
);
console.log(
  "PASS: stored protocol edits restore the current text without changing original timestamp.",
);
