import mongoose from "mongoose";

const loginTokenSchema = new mongoose.Schema(
  {
    loginToken: {
      type: String,
      required: true,
    },
    userId: {
      type: mongoose.Types.ObjectId,
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

const LoginTokenModel =
  mongoose.models.LoginToken || mongoose.model("LoginToken", loginTokenSchema);
export default LoginTokenModel; // export the model
