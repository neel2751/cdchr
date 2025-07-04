import Rota from "./rota";

export default async function Home({ searchParams }) {
  const param = await searchParams;
  return <Rota searchParams={param} />;
}
