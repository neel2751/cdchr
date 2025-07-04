"use client";

export default function ConnectButton({ connected }) {
  const handleConnect = () => {
    // Set your user_id in a cookie first
    window.location.href = "/api/auth/microsoft";
  };
  return (
    <button
      onClick={handleConnect}
      className="bg-blue-600 text-white px-4 py-2 rounded"
    >
      {connected ? "Reconnect Microsoft" : "Connect Microsoft"}
    </button>
  );
}
