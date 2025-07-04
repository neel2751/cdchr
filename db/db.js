import mongoose from "mongoose";

let isConnected; // Flag to check if the connection is established

export async function connect() {
  if (isConnected) {
    console.log("Database is already connected");
    return;
  }
  try {
    const db = await mongoose.connect(process.env.MONGO_DB_URL, {
      maxPoolSize: 10,
    });
    isConnected = db.connection.readyState === 1;
    console.log("Database connected successfully");
  } catch (error) {
    console.error("Error connecting to database", error);
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
