import Link from "next/link";
import { Button } from "@/components/ui/button";
import { swapAddress } from "../lib/contractrefs";

export default function Home() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-8 text-center bg-gray-900 text-white">
      <main className="max-w-3xl mx-auto">
        <h1 className="text-4xl font-bold mb-6 text-cyan-400">
          Decentralized P2P Token Swap
        </h1>

        <p className="text-xl mb-8 text-gray-300">
          Safely exchange tokens with hash time-locked contracts
        </p>

        <div className="space-y-8 mb-12">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="border border-gray-700 rounded-lg p-6 bg-gray-800 hover:shadow-lg hover:shadow-cyan-500/50 transition-shadow">
              <h2 className="text-xl font-semibold mb-3 text-cyan-300">Create Offers</h2>
              <p className="text-gray-400">
                Lock tokens with a hash time-locked contract to create buy or sell offers
              </p>
            </div>

            <div className="border border-gray-700 rounded-lg p-6 bg-gray-800 hover:shadow-lg hover:shadow-cyan-500/50 transition-shadow">
              <h2 className="text-xl font-semibold mb-3 text-cyan-300">Safe Exchanges</h2>
              <p className="text-gray-400">
                Trade tokens securely with cryptographic proofs and time locks
              </p>
            </div>

            <div className="border border-gray-700 rounded-lg p-6 bg-gray-800 hover:shadow-lg hover:shadow-cyan-500/50 transition-shadow">
              <h2 className="text-xl font-semibold mb-3 text-cyan-300">Full Control</h2>
              <p className="text-gray-400">
                Unlock, retrieve, or decline offers with complete control over your assets
              </p>
            </div>
          </div>
        </div>

        <div className="flex justify-center">
          <Link href="/swap">
            <Button size="lg" className="text-lg px-8 py-6 h-auto bg-cyan-500 hover:bg-cyan-600 text-gray-900 font-bold">
              Start Swapping
            </Button>
          </Link>
        </div>
      </main>

      <footer className="mt-16 text-gray-500 text-sm">
        <p>Connect to any EVM-compatible network</p>
        <p className="mt-2">Contract address : <span className="text-cyan-400">{swapAddress}</span></p>
      </footer>
    </div>
  );
}
