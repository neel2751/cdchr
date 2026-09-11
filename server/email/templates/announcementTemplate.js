import { emailButton } from "@/lib/emailTemplate";

/** Escape text that will sit inside HTML. */
function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Links are the one place a body can smuggle in a scheme; only these two. */
function safeHref(url) {
  const value = String(url ?? "").trim();
  return /^https?:\/\//i.test(value) ? escapeHtml(value) : "";
}

/**
 * Render the announcement body's markdown as email-safe HTML.
 *
 * A deliberately small subset: headings, bold, italic, inline code, links,
 * bullet and numbered lists, and paragraphs. The app renders the real thing
 * with react-markdown, but that is a React renderer — reaching for it here
 * would mean pulling renderToStaticMarkup into a background job to produce
 * markup that most mail clients would then strip anyway.
 *
 * Escaping runs FIRST and the transforms only ever emit their own tags, so an
 * author cannot put raw HTML — or a `javascript:` href — into a message that
 * goes out to the whole company. Anything unsupported degrades to its literal
 * text, which is readable rather than broken.
 */
export function markdownToEmailHtml(markdown) {
  const source = escapeHtml(markdown || "").replace(/\r\n/g, "\n");

  const inline = (text) =>
    text
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*([^*\n]+?)\*/g, "$1<em>$2</em>")
      .replace(/`([^`\n]+?)`/g, "<code>$1</code>")
      .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (match, label, href) => {
        const url = safeHref(href);
        return url
          ? `<a href="${url}" style="color:#4f46e5;">${label}</a>`
          : label;
      });

  const blocks = [];
  let list = null; // { tag: "ul"|"ol", items: [] }

  const closeList = () => {
    if (!list) return;
    const items = list.items.map((i) => `<li>${i}</li>`).join("");
    blocks.push(
      `<${list.tag} style="margin:0 0 12px;padding-left:20px;">${items}</${list.tag}>`
    );
    list = null;
  };

  for (const raw of source.split("\n")) {
    const line = raw.trim();

    if (!line) {
      closeList();
      continue;
    }

    const heading = line.match(/^(#{1,3})\s+(.*)$/);
    if (heading) {
      closeList();
      const size = [18, 16, 15][heading[1].length - 1];
      blocks.push(
        `<div style="margin:16px 0 8px;font-size:${size}px;font-weight:bold;color:#18181b;">${inline(
          heading[2]
        )}</div>`
      );
      continue;
    }

    const bullet = line.match(/^[-*]\s+(.*)$/);
    if (bullet) {
      if (list?.tag !== "ul") {
        closeList();
        list = { tag: "ul", items: [] };
      }
      list.items.push(inline(bullet[1]));
      continue;
    }

    const numbered = line.match(/^\d+\.\s+(.*)$/);
    if (numbered) {
      if (list?.tag !== "ol") {
        closeList();
        list = { tag: "ol", items: [] };
      }
      list.items.push(inline(numbered[1]));
      continue;
    }

    closeList();
    blocks.push(`<p style="margin:0 0 12px;">${inline(line)}</p>`);
  }

  closeList();
  return blocks.join("");
}

const PRIORITY_PREFIX = {
  urgent: "Urgent: ",
  important: "Important: ",
  normal: "",
};

/**
 * Subject and body for an announcement email.
 *
 * Returns a body fragment, not a whole document — sendTenantMail wraps it in
 * the company's branded shell, which is where the logo and colours come from.
 *
 * @param {Object} p
 * @param {string} p.title
 * @param {string} p.body            markdown
 * @param {string} [p.priority]      normal | important | urgent
 * @param {string} [p.authorName]
 * @param {boolean} [p.requireAck]
 * @param {string} [p.url]           link back to the announcement
 * @param {number} [p.attachmentCount]
 * @returns {{ subject: string, html: string, heading: string }}
 */
export function announcementTemplate({
  title,
  body,
  priority = "normal",
  authorName,
  requireAck = false,
  url,
  attachmentCount = 0,
}) {
  const subject = `${PRIORITY_PREFIX[priority] || ""}${title}`;

  const from = authorName
    ? `<p style="margin:0 0 16px;color:#71717a;font-size:13px;">From ${escapeHtml(
        authorName
      )}</p>`
    : "";

  const attachments =
    attachmentCount > 0
      ? `<p style="margin:16px 0 0;color:#71717a;font-size:13px;">This announcement has ${attachmentCount} attachment${
          attachmentCount === 1 ? "" : "s"
        }. Open it in the app to download ${
          attachmentCount === 1 ? "it" : "them"
        }.</p>`
      : "";

  // An acknowledgement can only be recorded in the app — there is no reply-to
  // handler — so the button is the whole call to action when one is required.
  const ack = requireAck
    ? `<p style="margin:16px 0 0;"><strong>Please confirm you have read this in the app.</strong></p>`
    : "";

  const button = url
    ? emailButton(requireAck ? "Read and acknowledge" : "Open in the app", url)
    : "";

  return {
    subject,
    heading: title,
    html: `${from}${markdownToEmailHtml(body)}${ack}${attachments}${button}`,
  };
}
