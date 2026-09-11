import { DiceApp } from "@/components/DiceApp";

// Server Component: the interactive surface is pushed down into DiceApp so the
// page itself ships no client JS of its own.
export default function Page() {
  return <DiceApp />;
}
