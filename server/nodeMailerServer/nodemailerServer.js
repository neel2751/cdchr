/**
 * NOT a "use server" module, deliberately.
 *
 * `sendMail` takes the host, port, username and password to connect with from
 * its caller — which is right for an internal transport helper and
 * indefensible for a public endpoint, which is what a "use server" export is.
 * It let an anonymous request open an SMTP connection from this server to any
 * host and port it named, and send whatever it liked through it.
 *
 * Only server code imports this. Keep it that way.
 */
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
    if (data.cc && (Array.isArray(data.cc) ? data.cc.length : data.cc)) {
      mailOptions.cc = data.cc;
    }
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
