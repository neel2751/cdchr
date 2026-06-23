import mongoose from "mongoose";

let isConnected; // Flag to check if the connection is established

export async function connect() {
  if (isConnected || mongoose.connection.readyState === 1) {
    isConnected = true;
    return;
  }

  if (mongoose.connection.readyState === 2) {
    return;
  }

  try {
    const db = await mongoose.connect(process.env.MONGO_DB_URL, {
      maxPoolSize: 50,
      minPoolSize: 5,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });
    isConnected = db.connection.readyState === 1;
  } catch (error) {
    console.log("Error connecting to database", error);
  }
  // try {
  //   mongoose.connect(process.env.MONGO_DB_URL);
  //   const connection = mongoose.connection;
  //   connection.on("Connected", () => {
  //     console.log("MongoDB connected successfully");

  //     connection.on("error", (err) => [
  //       console.log(`MongoDB error: ${err}`),
  //       process.exit(),
  //     ]);
  //   });
  // } catch (error) {
  //   console.error(error);
  // }
}
