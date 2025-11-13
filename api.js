// Conexión a JSONBin
const JSONBIN = {
  BIN_ID: "6913a0b0d0ea881f40e2784b",
  MASTER_KEY: "$2a$10$H00lm6NZqQ17IkrWznOoY.f41PGp.nnyv4/46AR1MQ53W3rnFoHV6"
};

const BIN_URL = id => `https://api.jsonbin.io/v3/b/${id}`;

async function jsonbinRead() {
  const res = await fetch(BIN_URL(JSONBIN.BIN_ID) + "/latest", {
    headers: {
      "X-Master-Key": JSONBIN.MASTER_KEY,
      "X-Bin-Meta": "false"
    }
  });
  if (!res.ok) throw new Error("JSONBin read failed");
  return res.json();
}

async function jsonbinWrite(payload) {
  const res = await fetch(BIN_URL(JSONBIN.BIN_ID), {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "X-Master-Key": JSONBIN.MASTER_KEY
    },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error("JSONBin write failed");
  return res.json();
}
