import mongoose from "mongoose";

/**
 * Our account with one carrier.
 *
 * Platform-level: the postage account is ours, paid from our card, and a
 * customer never sees it. Listed in GLOBAL_MODELS alongside TagProduct.
 *
 * Credentials are stored sealed (lib/secretBox.js) and never returned to a
 * screen. `hint` exists so an operator can tell which key is stored without
 * being shown it — four characters is enough to distinguish two keys and not
 * enough to be worth stealing.
 */
const carrierAccountSchema = new mongoose.Schema(
  {
    // A provider key from lib/carrierProviders.js, not a carrier key from
    // data/carriers.js. They overlap by name but answer different questions:
    // one is "who is carrying it", the other "who sells us the label".
    provider: { type: String, required: true, unique: true, trim: true },

    // { fieldName: "iv:tag:ciphertext" } — see lib/secretBox.js.
    credentials: {
      type: Map,
      of: String,
      default: () => new Map(),
    },
    // { fieldName: "····1234" }
    hints: {
      type: Map,
      of: String,
      default: () => new Map(),
    },

    // Which of the carrier's hosts to talk to. Not a secret, so it is a plain
    // field rather than a sealed credential.
    //
    // Defaults to test, and that default matters: no adapter here has been run
    // against a live account, so the first call any of them makes should be to
    // a sandbox that cannot charge anybody. Only UPS publishes a separate test
    // host; for carriers that do not, this is ignored and the note on their
    // adapter says so.
    environment: {
      type: String,
      enum: ["test", "production"],
      default: "test",
    },

    // Off by default. An account with credentials that nobody has tested is
    // not an account anybody should be buying postage through by accident.
    isEnabled: { type: Boolean, default: false },

    lastTestedAt: Date,
    lastTestOk: Boolean,
    lastTestMessage: String,
  },
  { timestamps: true },
);

// Deliberately NOT tenant-scoped. See the note above.
const CarrierAccountModel =
  mongoose.models.CarrierAccount ||
  mongoose.model("CarrierAccount", carrierAccountSchema);

export default CarrierAccountModel;
