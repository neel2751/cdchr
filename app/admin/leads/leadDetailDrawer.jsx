import { MessageSquare } from "lucide-react";

// /app/admin/leads/LeadDetailDrawer.jsx
export default function LeadDetailDrawer({ lead, onClose }) {
  const handleWhatsAppClick = () => {
    const visitorName =
      lead.data.fullName || lead.data.visitorName || lead.data.name || "there";
    const campaign = lead.qrCodeId?.title || "our campaign";

    const customMsg = `Hi ${visitorName}, this is ${
      lead?.agentName || "CDC"
    } regarding your inquiry via ${campaign}. How can I help you today? (Ref: ${lead._id.slice(
      -5
    )})`;

    const WhatsAppURL = `https://wa.me/?text=${encodeURIComponent(customMsg)}`;

    window.open(WhatsAppURL, "_blank");

    // Use the bridge API to track the click
  };

  const renderValue = (value) => {
    if (Array.isArray(value)) {
      // Handle MultiGroup (Arrays of Objects)
      return (
        <div className="mt-2 space-y-2">
          {value.map((item, i) => (
            <div key={i} className="p-3 bg-gray-50 rounded-lg border text-xs">
              {Object.entries(item).map(([k, v]) => (
                <div key={k} className="flex gap-2">
                  <span className="font-bold text-gray-500 uppercase">
                    {k}:
                  </span>
                  <span>{v}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      );
    }
    return <span className="text-gray-900 font-medium">{String(value)}</span>;
  };

  return (
    <div className="fixed inset-0 z-50 overflow-hidden">
      <div
        className="absolute inset-0 bg-black/30 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="absolute inset-y-0 right-0 w-full max-w-lg bg-white shadow-2xl flex flex-col animate-in slide-in-from-right duration-300">
        <div className="p-6 border-b flex justify-between items-center bg-gray-50">
          <h2 className="text-xl font-bold">Submission Details</h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-200 rounded-full"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Display all Mixed Data */}
          <div className="space-y-4">
            <h3 className="text-xs font-bold text-indigo-600 uppercase tracking-widest">
              Form Responses
            </h3>
            {Object.entries(lead.data).map(([key, val]) => (
              <div key={key} className="border-b pb-3">
                <label className="text-xs text-gray-400 uppercase font-bold block mb-1">
                  {key.replace(/([A-Z])/g, " $1")}
                </label>
                {renderValue(val)}
              </div>
            ))}
          </div>

          {/* Conversation/Timeline Section */}
          <div className="space-y-4 pt-6 border-t">
            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest">
              Lead Timeline
            </h3>
            <div className="bg-gray-50 p-4 rounded-xl italic text-sm text-gray-500 text-center">
              New lead captured via {lead.qrCodeId?.title}
            </div>
          </div>
        </div>

        <div className="p-6 border-t bg-gray-50 flex gap-3">
          <button className="flex-1 bg-indigo-600 text-white py-3 rounded-xl font-bold">
            Mark as Contacted
          </button>
          <button className="p-3 border rounded-xl bg-white">
            <MessageSquare className="w-5 h-5 text-gray-400" />
          </button>
        </div>
      </div>

      <button
        onClick={handleWhatsAppClick}
        className="fixed bottom-6 right-6 bg-green-500 text-white p-4 rounded-full shadow-lg flex items-center gap-2 hover:bg-green-600 transition-colors"
      >
        <MessageSquare className="w-5 h-5" />
      </button>
    </div>
  );
}
