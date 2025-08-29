import mongoose from "mongoose";

const bookingSchema = new mongoose.Schema(
  {
    serviceDate: { type: Date, required: true }, // "2023-10-15", "2023-11-01", etc.
    serviceTime: { type: String, required: true }, // "14:00", "09:30", etc.
    propertyType: { type: String, required: true }, // "Apartment", "House", "Condo", etc.
    designProcessTime: { type: String, required: true }, // "ASAP", "1-3 days", "1 week", etc.
    serviceType: { type: String, required: true }, // "Architectural Design", "Interior Design", "Landscape Design", etc.
    professionalType: { type: String, required: true }, // "Architect", "Interior Designer", "Landscape Architect", etc.
    budgetRange: { type: String, required: true }, // "£1000-$5000", "£5000-$10000", etc.
    propertyAddress: { type: String, required: true }, // "123 Main St, City, Country"
    customerName: { type: String, required: true },
    customerEmail: { type: String, required: true },
    customerPhone: { type: String, required: true },
    numberOfGuests: { type: Number, required: false },
    specialRequests: { type: String },
    reviewedTerms: { type: Boolean, required: true, default: false },
    agreedPrivacy: { type: Boolean, required: true, default: false },
    heardAboutUs: { type: String }, // "Online Search", "Social Media", "Friend Referral", etc.
    newsletterOptIn: { type: Boolean, default: false },
    referralSource: { type: String }, // "Google", "Friend", "Social Media", etc.
    additionalNotes: { type: String },
    status: {
      type: String,
      enum: ["pending", "confirmed", "completed", "canceled"],
      default: "pending",
    },
    assignedProfessional: { type: mongoose.Schema.Types.ObjectId },
    history: mongoose.Schema.Types.Mixed, // To store status changes and timestamps
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    isActive: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true }
);

const BookingModel =
  mongoose.models.Booking || mongoose.model("Booking", bookingSchema);
export default BookingModel;
