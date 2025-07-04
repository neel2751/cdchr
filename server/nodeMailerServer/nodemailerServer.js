"use server";
import nodemailer from "nodemailer";

export async function sendMail(data) {
  try {
    const transporter = nodemailer.createTransport({
      host: data.host,
      port: data.port || 587, // Default SMTP port
      secure: data.port === 465 ? true : data.secure || false, // true for 465, false for other ports
      auth: {
        user: data.userName,
        pass: data.password,
      },
    });
    if (!transporter) {
      return { success: false, message: "Failed to create transporter" };
    }
    const mailOptions = {
      from: `"${data.fromName}" <${data.userName}>`,
      to: data.toEmail,
      subject: data.subject || "No Subject",
      text: data.text || "No Content",
      html: data.html || "<p>No Content</p>",
    };
    const info = await transporter.sendMail(mailOptions);
    transporter.close();
    if (info.messageId) {
      return { success: true, message: "Email sent successfully" };
    } else {
      return { success: false, message: "Failed to send email" };
    }
  } catch (error) {
    console.error("Error sending email:", error);
    return { success: false, message: "Error sending email" };
  }
}
