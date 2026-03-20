const test = require("node:test");
const assert = require("node:assert/strict");

const { isBotIdentifier } = require("../plugins/utils/lid-helper");

const client = {
  user: {
    id: "905551112233:12@s.whatsapp.net",
    lid: "905551112233:34@lid",
  },
};

test("self-kick is blocked when target is @s.whatsapp.net", () => {
  const targetUser = "905551112233@s.whatsapp.net";
  assert.equal(isBotIdentifier(targetUser, client), true);
});

test("self-kick is blocked when target is @lid", () => {
  const targetUser = "905551112233@lid";
  assert.equal(isBotIdentifier(targetUser, client), true);
});

test("kick continues for a regular user target", () => {
  const targetUser = "905559998877@s.whatsapp.net";
  assert.equal(isBotIdentifier(targetUser, client), false);
});
