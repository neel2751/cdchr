import { getServerSideProps } from "@/server/session/session";

export default async function Layout({ employe, admin }) {
  const { props } = await getServerSideProps();
  const { session } = props;
  return session?.user?.role === "superAdmin" ? admin : employe;
}
