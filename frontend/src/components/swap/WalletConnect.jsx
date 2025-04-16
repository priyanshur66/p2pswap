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

  return (
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
              onClick={disconnectWallet}
              variant="destructive"
              size="sm"
              className="px-3 py-2 h-auto"
            >
              Disconnect
            </Button>
          </div>
        </>
      ) : (
        <Button
          onClick={connectWallet}
          className="px-3 py-2 h-auto"
        >
          Connect Wallet
        </Button>
      )}
    </div>
  );
};

export default WalletConnect; 