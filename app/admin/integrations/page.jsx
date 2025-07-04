import { checkIntegrationStatus } from "@/server/integrationServer/integrationServer";
import ConnectButton from "./connectButton";

export default async function MicrosoftIntegrationPage() {
  const connected = await checkIntegrationStatus();
  return (
    <div className="p-6">
      <h1 className="text-xl font-bold mb-4">Microsoft Integration</h1>
      {connected ? (
        <div className="text-green-600 mb-2">✅ Connected</div>
      ) : (
        <div className="text-red-600 mb-2">❌ Not Connected</div>
      )}
      <ConnectButton connected={connected} />
    </div>
  );
}
