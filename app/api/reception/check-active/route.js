import { getReceptionUserByEmail } from "@/server/receptionServer/receptionServer";
import { getServerSideProps } from "@/server/session/session";

export async function GET() {
  const { props } = await getServerSideProps();
  const { session } = props || {};
  if (!session) {
    return new Response(JSON.stringify({ message: "Unauthorized access" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  const response = await getReceptionUserByEmail(session.user.email);
  const isActive = response?.isActive || false;
  return new Response(JSON.stringify({ isActive }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
