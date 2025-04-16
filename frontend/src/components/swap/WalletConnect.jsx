"use client";

import { useBlockchain } from '@/lib/blockchain-context';
import { Button } from '@/components/ui/button';
import { useState, useEffect } from 'react';

const WalletConnect = () => {
  const { 
    isConnected, 
    account, 
    connectWallet, 
    disconnectWallet, 
    chainId,
    getCurrentNetwork
  } = useBlockchain();

  const [networkName, setNetworkName] = useState(null);
  const [lastRefresh, setLastRefresh] = useState(Date.now());
  const [debugInfo, setDebugInfo] = useState({
    hasEthereum: false,
    ethereumKeys: [],
    hasWallet: false
  });

  // Debug check for ethereum object
  useEffect(() => {
    const checkEthereumObject = () => {
      try {
        const hasEthereum = typeof window !== 'undefined' && window.ethereum !== undefined;
        let ethereumKeys = [];
        let hasWallet = false;
        
        if (hasEthereum) {
          ethereumKeys = Object.keys(window.ethereum);
          hasWallet = typeof window.ethereum.request === 'function';
        }
        
        setDebugInfo({
          hasEthereum,
          ethereumKeys,
          hasWallet
        });
        
        console.log("Ethereum debug info:", {
          hasEthereum, 
          ethereumKeys, 
          hasWallet
        });
      } catch (error) {
        console.error("Error checking ethereum object:", error);
      }
    };
    
    checkEthereumObject();
    const intervalId = setInterval(checkEthereumObject, 2000);
    
    return () => clearInterval(intervalId);
  }, []);

  useEffect(() => {
    // Refresh network info whenever connection state or chainId changes
    if (isConnected) {
      getCurrentNetwork().then(network => {
        if (network) {
          setNetworkName(network.name);
        }
      });
    }
  }, [isConnected, chainId, getCurrentNetwork]);

  // Additional polling for sandboxed environments
  useEffect(() => {
    if (!isConnected) return;
    
    // Set up a refresh interval that runs more frequently in sandboxed environments
    const refreshInterval = setInterval(() => {
      // Only refresh if it's been more than 3 seconds since last refresh
      if (Date.now() - lastRefresh > 3000) {
        getCurrentNetwork().then(network => {
          if (network) {
            setNetworkName(network.name);
          }
          setLastRefresh(Date.now());
        });
      }
    }, 2000);
    
    return () => clearInterval(refreshInterval);
  }, [isConnected, getCurrentNetwork, lastRefresh]);

  const formatAddress = (address) => {
    if (!address) return '';
    return `${address.substring(0, 6)}...${address.substring(address.length - 4)}`;
  };

  // Manual connect attempt function
  const attemptManualConnect = async () => {
    console.log("Attempting manual wallet connection...");
    try {
      if (window.ethereum) {
        const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
        console.log("Manual connection attempt returned accounts:", accounts);
        
        // Force context to reconnect
        if (accounts && accounts.length > 0) {
          console.log("Manually connected to account:", accounts[0]);
          connectWallet();
        }
      } else {
        console.error("No ethereum object found for manual connection");
      }
    } catch (error) {
      console.error("Manual connection failed:", error);
    }
  };

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="flex flex-col sm:flex-row items-center gap-3">
        {isConnected ? (
          <>
            <div className="flex items-center space-x-1">
              <div className={`w-3 h-3 rounded-full bg-green-500`}></div>
              <span className="text-xs">
                {networkName || 'Connected'}
              </span>
            </div>
            
            <div className="flex items-center gap-2">
              <Button 
                variant="outline" 
                size="sm"
                className="px-3 py-2 h-auto"
              >
                {formatAddress(account)}
              </Button>
              
              <Button
                onClick={() => {
                  console.log("Disconnect wallet button clicked");
                  try {
                    disconnectWallet();
                  } catch (error) {
                    console.error("Error in disconnectWallet click handler:", error);
                  }
                }}
                variant="destructive"
                size="sm"
                className="px-3 py-2 h-auto"
              >
                Disconnect
              </Button>
            </div>
          </>
        ) : (
          <>
            <Button
              onClick={() => {
                console.log("Connect wallet button clicked");
                try {
                  connectWallet();
                } catch (error) {
                  console.error("Error in connectWallet click handler:", error);
                }
              }}
              className="px-3 py-2 h-auto"
            >
              Connect Wallet
            </Button>
            
            <Button
              onClick={attemptManualConnect}
              variant="outline"
              className="px-3 py-2 h-auto"
            >
              Try Alternative Connect
            </Button>
          </>
        )}
      </div>
      
      {/* Debug section - only show in dev or when there are connection issues */}
      <div className="text-xs text-gray-500 mt-1">
        <div>Ethereum available: {debugInfo.hasEthereum ? "✅" : "❌"}</div>
        {debugInfo.hasEthereum && (
          <>
            <div>Wallet available: {debugInfo.hasWallet ? "✅" : "❌"}</div>
            <div>Provider methods: {debugInfo.ethereumKeys.slice(0, 3).join(', ')}...</div>
          </>
        )}
      </div>
    </div>
  );
};

export default WalletConnect; 