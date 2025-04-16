"use client";

import { createContext, useContext, useState, useEffect } from 'react';
import { ethers } from 'ethers';
import { swapAbi, swapAddress, erc20Abi } from './contractrefs.js';
import { useToast } from '@/components/ui/use-toast';

const BlockchainContext = createContext();

export function useBlockchain() {
  return useContext(BlockchainContext);
}

export function BlockchainProvider({ children }) {
  const [provider, setProvider] = useState(null);
  const [signer, setSigner] = useState(null);
  const [swapContract, setSwapContract] = useState(null);
  const [account, setAccount] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [chainId, setChainId] = useState(null);
  const [events, setEvents] = useState([]);
  const { toast } = useToast();

  // Handle account changes - moved outside setupWalletEventListeners to be accessible from polling
  const handleAccountsChanged = async (accounts) => {
    console.log("Accounts changed:", accounts);
    
    // Get the current account from state for comparison
    const currentAccount = account;
    const newAccount = accounts && accounts.length > 0 ? accounts[0] : null;
    
    // Check if this is a real account change
    if (newAccount && currentAccount && 
        newAccount.toLowerCase() === currentAccount.toLowerCase()) {
      console.log("Same account detected, no need to reinitialize");
      return;
    }
    
    // Immediately clear events when account changes
    setEvents([]);
    
    if (accounts.length > 0) {
      // Completely reinitialize everything when account changes
      try {
        console.log("Reinitializing provider, signer, and contract for new account");
        
        // Create a fresh provider
        const newProvider = new ethers.BrowserProvider(window.ethereum);
        
        // Get network
        const network = await newProvider.getNetwork();
        setChainId(network.chainId);
        
        // Create a fresh signer for the new account
        const newSigner = await newProvider.getSigner();
        
        // Create a fresh contract
        const newSwapContract = new ethers.Contract(swapAddress, swapAbi, newSigner);
        
        // Set all state
        setProvider(newProvider);
        setSigner(newSigner);
        setSwapContract(newSwapContract);
        setAccount(accounts[0]);
        setIsConnected(true); // Make sure to set isConnected to true
        
        console.log("New signer address:", await newSigner.getAddress());
        console.log("Updated state with new account:", accounts[0]);
        
        // Set up fresh event listeners with the new contract
        listenForEvents(newSwapContract);
        
        // Fetch past events for the new account
        fetchPastEvents(newSwapContract)
          .then(pastEvents => {
            if (pastEvents && pastEvents.length > 0) {
              console.log(`Setting ${pastEvents.length} events after account change`);
              setEvents(pastEvents);
            }
          })
          .catch(error => {
            console.error("Error fetching events after account change:", error);
          });
      } catch (error) {
        console.error("Error reinitializing after account change:", error);
        // In case of critical failure, try to disconnect
        disconnectWallet();
      }
    } else {
      disconnectWallet();
    }
  };

  // Handle chain/network changes
  const handleChainChanged = async (_chainId) => {
    console.log("Chain changed to:", _chainId);
    
    try {
      // Get chain ID in a normalized format
      const newChainId = typeof _chainId === 'string' && _chainId.startsWith('0x') 
        ? BigInt(_chainId) 
        : BigInt(_chainId);
      
      // If we have the current chain ID in state, compare to avoid unnecessary reloads
      if (chainId) {
        const currentChainIdBigInt = typeof chainId === 'bigint' ? chainId : BigInt(chainId.toString());
        
        if (newChainId === currentChainIdBigInt) {
          console.log("Same chain detected, no need to reload");
          return;
        }
      }
      
      // Try to handle chain change gracefully instead of a full page reload
      try {
        console.log("Reinitializing provider and contracts for new chain");
        
        // Create fresh provider, signer and contract
        const newProvider = new ethers.BrowserProvider(window.ethereum);
        const network = await newProvider.getNetwork();
        setChainId(network.chainId);
        
        // Only recreate signer and contract if we have an account
        if (account) {
          const newSigner = await newProvider.getSigner();
          const newSwapContract = new ethers.Contract(swapAddress, swapAbi, newSigner);
          
          // Update state
          setProvider(newProvider);
          setSigner(newSigner);
          setSwapContract(newSwapContract);
          
          // Reset and restart event listeners
          listenForEvents(newSwapContract);
          
          // Fetch past events for the new chain
          fetchPastEvents(newSwapContract)
            .then(pastEvents => {
              setEvents(pastEvents || []);
            })
            .catch(console.error);
          
          // Notify user
          toast({
            title: "Network Changed",
            description: `Connected to ${network.name || 'new network'}`,
          });
          
          return;
        }
      } catch (error) {
        console.error("Error handling chain change gracefully, falling back to page reload:", error);
      }
      
      // If graceful handling fails, fall back to page reload
      window.location.reload();
    } catch (error) {
      console.error("Error in chain change handler:", error);
      window.location.reload();
    }
  };

  // Set up wallet event listeners
  const setupWalletEventListeners = () => {
    const ethereumProvider = window.ethereum;
    if (!ethereumProvider) {
      console.warn("Cannot set up wallet event listeners - no ethereum provider found");
      return;
    }
    
    console.log("Setting up wallet event listeners");
    
    // Try multiple ways to remove and add listeners for different wallet implementations
    const safeRemoveListener = (event, handler) => {
      try {
        // Try standard method first
        ethereumProvider.removeListener(event, handler);
        console.log(`Removed listener for ${event} event`);
      } catch (e1) {
        console.warn(`Standard removeListener for ${event} failed:`, e1);
        try {
          // Some wallets use off instead
          if (typeof ethereumProvider.off === 'function') {
            ethereumProvider.off(event, handler);
            console.log(`Removed listener for ${event} using off method`);
          }
        } catch (e2) {
          console.warn(`Alternative off method for ${event} failed:`, e2);
        }
      }
    };
    
    const safeAddListener = (event, handler) => {
      try {
        // Try standard method first
        ethereumProvider.on(event, handler);
        console.log(`Added listener for ${event} event`);
        return true;
      } catch (e1) {
        console.warn(`Standard on method for ${event} failed:`, e1);
        try {
          // Some wallets use addListener instead
          if (typeof ethereumProvider.addListener === 'function') {
            ethereumProvider.addListener(event, handler);
            console.log(`Added listener for ${event} using addListener`);
            return true;
          }
        } catch (e2) {
          console.warn(`Alternative addListener method for ${event} failed:`, e2);
        }
        
        try {
          // Last resort - try RPC provider specific event listener
          if (typeof ethereumProvider.on === 'function') {
            ethereumProvider.on(event, (...args) => {
              console.log(`${event} event triggered with:`, args);
              handler(...args);
            });
            console.log(`Added fallback listener for ${event}`);
            return true;
          }
        } catch (e3) {
          console.warn(`Fallback listener for ${event} failed:`, e3);
        }
        
        return false;
      }
    };
    
    // Remove existing listeners first to avoid duplicates
    safeRemoveListener('accountsChanged', handleAccountsChanged);
    safeRemoveListener('chainChanged', handleChainChanged);
    
    // Add listeners with enhanced error handling
    const accountsResult = safeAddListener('accountsChanged', handleAccountsChanged);
    const chainResult = safeAddListener('chainChanged', handleChainChanged);
    
    // Log success status
    console.log("Wallet event listeners setup results:", {
      accountsChanged: accountsResult ? "success" : "failed",
      chainChanged: chainResult ? "success" : "failed"
    });
    
    // Store setup status for polling fallback
    window._walletEventListenersActive = accountsResult && chainResult;
    
    if (!accountsResult || !chainResult) {
      console.warn("Some wallet event listeners failed to set up. Polling will be used as fallback.");
    } else {
      console.log("Wallet event listeners set up successfully");
    }
  };

  // Connect to wallet
  const connectWallet = async () => {
    console.log("Connect wallet function called");
    
    // Check for ethereum object with fallbacks for container environments
    const getEthereumProvider = () => {
      if (window.ethereum) return window.ethereum;
      
      // Check for alternate injection methods in Bolt/containers
      const possibleProviders = [
        window.ethereum,
        window.web3?.currentProvider,
        window._ethereum, // Some containers use this
        window.__ethereum // Some containers use this
      ];
      
      for (const provider of possibleProviders) {
        if (provider) {
          console.log("Found alternate ethereum provider:", provider);
          // Add it to window.ethereum for consistency with the rest of the code
          window.ethereum = provider;
          return provider;
        }
      }
      
      return null;
    };
    
    const ethereumProvider = getEthereumProvider();
    
    if (!ethereumProvider) {
      console.error("No ethereum provider found in window object");
      toast({
        title: "Wallet Not Found",
        description: "Please install MetaMask or another Ethereum wallet",
        variant: "destructive",
      });
      return false;
    }
    
    try {
      console.log("Connecting wallet...");
      console.log("ethereum provider object:", Object.keys(ethereumProvider));
      
      // Force reset of any existing connections
      if (isConnected) {
        console.log("Resetting existing connection before reconnecting");
        setProvider(null);
        setSigner(null);
        setSwapContract(null);
        setAccount(null);
        setIsConnected(false);
      }
        
      // Create new provider with retry logic for sandboxed environments
      let provider;
      let retryCount = 0;
      
      while (retryCount < 3) {
        try {
          provider = new ethers.BrowserProvider(ethereumProvider);
          break;
        } catch (providerError) {
          console.warn(`Provider creation attempt ${retryCount + 1} failed:`, providerError);
          retryCount++;
          if (retryCount >= 3) throw providerError;
          await new Promise(r => setTimeout(r, 500)); // Wait 500ms before retry
        }
      }
      
      // Multiple methods to request accounts for different environments
      const requestAccounts = async () => {
        const methods = [
          // Standard method
          async () => provider.send("eth_requestAccounts", []),
          // Direct request method
          async () => ethereumProvider.request({ method: 'eth_requestAccounts' }),
          // Legacy web3 method
          async () => {
            if (window.web3 && window.web3.eth && window.web3.eth.getAccounts) {
              return new Promise((resolve, reject) => {
                window.web3.eth.getAccounts((error, accounts) => {
                  if (error) reject(error);
                  else resolve(accounts);
                });
              });
            }
            throw new Error("Legacy web3 not available");
          },
          // Last resort - try to get already connected accounts
          async () => ethereumProvider.request({ method: 'eth_accounts' })
        ];
        
        let lastError;
        for (const method of methods) {
          try {
            const accounts = await method();
            if (accounts && accounts.length > 0) return accounts;
          } catch (error) {
            lastError = error;
            console.warn("Account request method failed, trying next method:", error);
          }
        }
        
        throw lastError || new Error("All account request methods failed");
      };
      
      // Try to get accounts
      const accounts = await requestAccounts();
      
      if (!accounts || accounts.length === 0) {
        throw new Error("No accounts returned after wallet connection request");
      }
      
      console.log("Successfully got accounts:", accounts);
      
      const network = await provider.getNetwork();
      setChainId(network.chainId);
      
      // Create signer with retry logic
      let signer;
      retryCount = 0;
      
      while (retryCount < 3) {
        try {
          signer = await provider.getSigner();
          break;
        } catch (signerError) {
          console.warn(`Signer creation attempt ${retryCount + 1} failed:`, signerError);
          retryCount++;
          if (retryCount >= 3) throw signerError;
          await new Promise(r => setTimeout(r, 500)); // Wait 500ms before retry
        }
      }
      
      const swapContract = new ethers.Contract(swapAddress, swapAbi, signer);
      
      // Set state
      setProvider(provider);
      setSigner(signer);
      setSwapContract(swapContract);
      setAccount(accounts[0]);
      setIsConnected(true);

      // Set up wallet event listeners after successful connection
      setupWalletEventListeners();

      toast({
        title: "Wallet Connected",
        description: `Connected to ${accounts[0].substring(0, 6)}...${accounts[0].substring(38)}`,
      });

      // Set up event listeners after the state is updated
      setTimeout(async () => {
        try {
          // Start listening for events
          console.log("Setting up event listeners...");
          listenForEvents(swapContract);
          
          // Fetch past events
          console.log("Fetching past events after connecting wallet");
          try {
            const pastEvents = await fetchPastEvents(swapContract);
            if (pastEvents && pastEvents.length > 0) {
              console.log(`Setting ${pastEvents.length} past events to state`);
              setEvents(pastEvents);
            } else {
              console.log("No past events found");
            }
          } catch (pastEventsError) {
            console.error("Error fetching past events during connect:", pastEventsError);
          }
        } catch (eventError) {
          console.error("Error setting up events:", eventError);
        }
      }, 100); // Small delay to ensure state is updated
      
      return true;
    } catch (error) {
      console.error("Error connecting to wallet:", error);
      toast({
        title: "Connection Error",
        description: error.message,
        variant: "destructive",
      });
      return false;
    }
  };

  // Disconnect wallet
  const disconnectWallet = async () => {
    console.log("Disconnect wallet function called");
    
    try {
      // Clear all event listeners before disconnecting
      if (swapContract) {
        try {
          console.log("Removing contract event listeners");
          swapContract.removeAllListeners();
        } catch (error) {
          console.warn("Error removing contract listeners:", error);
        }
      }

      // Force reset wallet connection state
      console.log("Resetting connection state");
      setProvider(null);
      setSigner(null);
      setSwapContract(null);
      setAccount(null);
      setIsConnected(false);
      setChainId(null);
      setEvents([]);
      
      toast({
        title: "Wallet Disconnected",
        description: "You have been disconnected from your wallet",
      });
      
      // Some wallet implementations require an explicit disconnect
      // This will be a no-op on wallets that don't support it
      if (window.ethereum && typeof window.ethereum.disconnect === 'function') {
        try {
          await window.ethereum.disconnect();
          console.log("Explicitly disconnected from wallet provider");
        } catch (disconnectError) {
          console.warn("Provider doesn't support explicit disconnect:", disconnectError);
        }
      }
      
      return true;
    } catch (error) {
      console.error("Error during wallet disconnect:", error);
      return false;
    }
  };

  // Listen for contract events
  const listenForEvents = (contract) => {
    if (!contract) {
      console.error("Cannot listen for events - contract is null");
      return;
    }

    // If there's no account, we can't properly filter events
    if (!account) {
      console.warn("No account set, cannot properly filter events");
    }

    console.log("Setting up event listeners for contract", contract.target, "with account", account);
    
    // Cleanup existing listeners to avoid duplicates
    try {
      contract.removeAllListeners();
      console.log("Removed existing event listeners");
    } catch (error) {
      console.warn("Error removing listeners:", error);
    }

    const lockBuyFilter = contract.filters.LockBuy();
    const lockSellFilter = contract.filters.LockSell();
    const unlockFilter = contract.filters.Unlock();
    const retrieveFilter = contract.filters.Retrieve();
    const declineFilter = contract.filters.Decline();

    console.log("Event filters created:", { 
      lockBuyFilter, lockSellFilter, unlockFilter, retrieveFilter, declineFilter 
    });

    // Helper to check if the event is relevant to current account
    const isEventForCurrentAccount = (creator, recipient) => {
      if (!account) return true; // If no account is set, consider all events
      return (
        creator?.toLowerCase() === account?.toLowerCase() || 
        recipient?.toLowerCase() === account?.toLowerCase()
      );
    };

    contract.on(lockBuyFilter, (token, creator, recipient, hashedSecret, timeout, value, sellAssetId, sellPrice, lockId) => {
      console.log("LockBuy event received:", { token, creator, recipient, hashedSecret, timeout: Number(timeout), value: value.toString(), sellAssetId, sellPrice: sellPrice.toString(), lockId });
      
      const newEvent = {
        type: 'LockBuy',
        token,
        creator,
        recipient,
        hashedSecret,
        timeout: Number(timeout),
        value: value.toString(),
        sellAssetId,
        sellPrice: sellPrice.toString(),
        lockId,
        timestamp: Date.now()
      };
      
      setEvents(prev => {
        console.log("Adding LockBuy event to state, current count:", prev.length);
        return [newEvent, ...prev];
      });
      
      if (isEventForCurrentAccount(creator, recipient)) {
        toast({
          title: "New Lock Buy",
          description: `A new lock buy has been created with ID: ${lockId.substring(0, 10)}...`,
        });
      }
    });

    contract.on(lockSellFilter, (token, creator, recipient, hashedSecret, timeout, value, buyAssetId, buyLockId) => {
      const newEvent = {
        type: 'LockSell',
        token,
        creator,
        recipient,
        hashedSecret,
        timeout: Number(timeout),
        value: value.toString(),
        buyAssetId,
        buyLockId,
        timestamp: Date.now()
      };
      
      setEvents(prev => [newEvent, ...prev]);
      
      if (isEventForCurrentAccount(creator, recipient)) {
        toast({
          title: "New Lock Sell",
          description: `A new lock sell has been created for asset: ${buyAssetId.substring(0, 10)}...`,
        });
      }
    });

    contract.on(unlockFilter, (token, creator, recipient, lockId, secret) => {
      const newEvent = {
        type: 'Unlock',
        token,
        creator,
        recipient,
        lockId,
        secret,
        timestamp: Date.now()
      };
      
      setEvents(prev => [newEvent, ...prev]);
      
      if (isEventForCurrentAccount(creator, recipient)) {
        toast({
          title: "Lock Unlocked",
          description: `Lock with ID: ${lockId.substring(0, 10)}... has been unlocked`,
        });
      }
    });

    contract.on(retrieveFilter, (token, creator, recipient, lockId) => {
      const newEvent = {
        type: 'Retrieve',
        token,
        creator,
        recipient,
        lockId,
        timestamp: Date.now()
      };
      
      setEvents(prev => [newEvent, ...prev]);
      
      if (isEventForCurrentAccount(creator, recipient)) {
        toast({
          title: "Lock Retrieved",
          description: `Lock with ID: ${lockId.substring(0, 10)}... has been retrieved`,
        });
      }
    });

    contract.on(declineFilter, (token, creator, recipient, lockId) => {
      const newEvent = {
        type: 'Decline',
        token,
        creator,
        recipient,
        lockId,
        timestamp: Date.now()
      };
      
      setEvents(prev => [newEvent, ...prev]);
      
      if (isEventForCurrentAccount(creator, recipient)) {
        toast({
          title: "Lock Declined",
          description: `Lock with ID: ${lockId.substring(0, 10)}... has been declined`,
        });
      }
    });
  };

  // Create token contract instance
  const getTokenContract = async (tokenAddress) => {
    if (!signer) return null;
    
    // Verify and potentially update signer before creating contract
    const verifiedSigner = await verifySigner();
    if (!verifiedSigner) return null;
    
    return new ethers.Contract(tokenAddress, erc20Abi, verifiedSigner);
  };

  // Helper function to verify signer matches current account
  const verifySigner = async () => {
    if (!signer || !account || !provider) return false;
    
    try {
      const signerAddress = await signer.getAddress();
      console.log("Verifying signer address matches account:", {
        signerAddress,
        account
      });
      
      if (signerAddress.toLowerCase() !== account.toLowerCase()) {
        console.warn("Signer address doesn't match current account, reinitializing contract");
        
        // Create a fresh signer and contract
        const newSigner = await provider.getSigner();
        const newSwapContract = new ethers.Contract(swapAddress, swapAbi, newSigner);
        
        // Update state
        setSigner(newSigner);
        setSwapContract(newSwapContract);
        
        console.log("Updated signer and contract to match current account");
        return newSigner;
      }
      
      return signer;
    } catch (error) {
      console.error("Error verifying signer:", error);
      return false;
    }
  };

  // Lock Buy function
  const lockBuy = async (tokenAddress, recipient, hashedSecret, timeout, value, sellAssetId, sellPrice, useRawValue = false, useRawSellPrice = false) => {
    if (!swapContract || !signer) {
      toast({
        title: "Error",
        description: "Wallet not connected",
        variant: "destructive",
      });
      return;
    }

    try {
      // Verify signer matches the current account
      await verifySigner();
      
      // Format values to match contract expectations
      let valueWei;
      try {
        if (useRawValue) {
          // If using raw value, parse as a BigInt - ensure it's a valid number
          valueWei = BigInt(String(value).trim());
          console.log("Using raw token value:", valueWei.toString());
        } else {
          // Otherwise convert from ETH to wei
          value = value*1000000;
          valueWei = BigInt(String(value).trim());
          console.log("taking decimal point of 6:", valueWei.toString());
        }
      } catch (valueError) {
        console.error("Error parsing value:", valueError);
        throw new Error(`Invalid value format: ${value}. Please provide a valid number.`);
      }
      
      // For sellPrice, similar logic
      let sellPriceWei;
      try {
        if (useRawSellPrice) {
          // If using raw value, parse as a BigInt - ensure it's a valid number
          sellPriceWei = BigInt(String(sellPrice).trim());
          console.log("Using raw sell price:", sellPriceWei.toString());
        } else {
          // Otherwise convert from ETH to wei
          sellPrice = sellPrice*1000000;
          sellPriceWei = BigInt(String(sellPrice).trim());
          console.log("taking decimal point of 6:", sellPriceWei.toString());
        }
      } catch (priceError) {
        console.error("Error parsing price:", priceError);
        throw new Error(`Invalid price format: ${sellPrice}. Please provide a valid number.`);
      }
      
      // Ensure sellAssetId is properly formatted as bytes32
      let formattedSellAssetId;
      if (!sellAssetId || sellAssetId.trim() === '') {
        formattedSellAssetId = ethers.ZeroHash;
        console.log("Using zero hash for empty sellAssetId");
      } else if (sellAssetId.startsWith('0x') && sellAssetId.length === 66) {
        formattedSellAssetId = sellAssetId;
        console.log("Using provided bytes32 sellAssetId");
      } else {
        // Generate a bytes32 from non-hex input
        formattedSellAssetId = ethers.keccak256(ethers.toUtf8Bytes(sellAssetId));
        console.log("Generated hash for sellAssetId:", formattedSellAssetId);
      }
      
      // Pass timeout directly without adding current time
      const timeoutInt = Math.floor(Number(timeout));
      console.log("Using raw timeout value:", timeoutInt);
      
      // Get token contract
      const tokenContract = await getTokenContract(tokenAddress);
      if (!tokenContract) {
        throw new Error("Failed to create token contract instance");
      }
      
      // Check token decimals
      let tokenDecimals;
      try {
        tokenDecimals = await tokenContract.decimals();
        console.log("Token decimals:", tokenDecimals);
      } catch (decimalsError) {
        console.warn("Could not fetch token decimals, assuming 18:", decimalsError);
        tokenDecimals = 18;
      }
      
      // Check token balance
      try {
        const balance = await tokenContract.balanceOf(account);
        console.log("Token balance:", balance.toString(), "needed:", valueWei.toString());
        
        if (balance < valueWei) {
          throw new Error(`Insufficient token balance. You have ${balance.toString()} but need ${valueWei.toString()}`);
        }
      } catch (balanceError) {
        if (balanceError.message.includes("Insufficient")) {
          throw balanceError; // Re-throw if it's our custom error
        }
        console.error("Error checking balance:", balanceError);
      }
      
      console.log("Complete lockBuy parameters:", {
        token: tokenAddress,
        recipient,
        hashedSecret,
        timeout: timeoutInt,
        value: valueWei.toString(),
        sellAssetId: formattedSellAssetId,
        sellPrice: sellPriceWei.toString()
      });
      
      // Check existing allowance
      try {
        const currentAllowance = await tokenContract.allowance(account, swapAddress);
        console.log("Current allowance:", currentAllowance.toString(), "needed:", valueWei.toString());
        
        // Only request approval if the current allowance is less than the needed amount
        if (currentAllowance < valueWei) {
          console.log("Approving transfer", {
            token: tokenAddress,
            amount: valueWei.toString(),
            spender: swapAddress
          });
          
          // Request approval for the token transfer
          const approveTx = await tokenContract.approve(swapAddress, valueWei);
          const approveReceipt = await approveTx.wait();
          console.log("Approval confirmed:", approveReceipt.hash);
        } else {
          console.log("Token already approved for the required amount");
        }
      } catch (approvalError) {
        console.error("Error during token approval:", approvalError);
        throw new Error(`Failed to approve token transfer: ${approvalError.message}`);
      }

      // Try to estimate gas for the transaction first
      try {
        console.log("Estimating gas for lockBuy transaction...");
        const gasEstimate = await swapContract.lockBuy.estimateGas(
          tokenAddress,
          recipient,
          hashedSecret,
          timeoutInt,
          valueWei,
          formattedSellAssetId,
          sellPriceWei
        );
        console.log("Estimated gas:", gasEstimate.toString());
      } catch (gasError) {
        console.error("Gas estimation failed:", gasError);
        // We'll continue without gas estimation, but this indicates the transaction might fail
        console.warn("The transaction might fail based on gas estimation. Check your parameters carefully.");
      }

      // Then call lockBuy with properly formatted parameters
      console.log("Sending lockBuy transaction...");
      const tx = await swapContract.lockBuy(
        tokenAddress,
        recipient,
        hashedSecret,
        timeoutInt,
        valueWei,
        formattedSellAssetId,
        sellPriceWei,
        // Add gas limit with buffer to avoid failure
        { gasLimit: 1000000 }
      );
      
      toast({
        title: "Transaction Submitted",
        description: "Your lock buy transaction has been submitted",
      });
      
      console.log("Transaction sent:", tx.hash);
      const receipt = await tx.wait();
      console.log("Transaction receipt:", receipt);
      
      // Extract the lockId from the event
      const lockBuyEvent = receipt.logs
        .filter(log => log.address.toLowerCase() === swapAddress.toLowerCase())
        .map(log => {
          try {
            return swapContract.interface.parseLog(log);
          } catch (e) {
            console.error("Error parsing log:", e);
            return null;
          }
        })
        .find(event => event && event.name === 'LockBuy');
      
      const lockId = lockBuyEvent ? lockBuyEvent.args.lockId : null;
      console.log("Created lock with ID:", lockId);
      
      toast({
        title: "Lock Buy Created",
        description: `Your lock buy has been successfully created${lockId ? ` with ID: ${lockId.substring(0,10)}...` : ''}`,
      });
      
      return { tx, lockId };
    } catch (error) {
      console.error("Error in lockBuy:", error);

      // Try to extract more meaningful error information
      let errorMessage = error.message;
      
      if (error.code === 'CALL_EXCEPTION') {
        errorMessage = 'Transaction reverted by the contract. This could be due to: insufficient allowance, incorrect parameters, token balance too low, or contract restrictions.';
        
        // Try to get more info from the error data
        if (error.data) {
          errorMessage += ` Data: ${error.data}`;
        }
        
        // If we have transaction data in the error, let's log it
        if (error.transaction) {
          console.error("Failed transaction details:", error.transaction);
        }
      }
      
      toast({
        title: "Transaction Failed",
        description: errorMessage,
        variant: "destructive",
      });
      throw error;
    }
  };

  // Lock Sell function
  const lockSell = async (tokenAddress, recipient, hashedSecret, timeout, value, buyAssetId, buyLockId, useRawValue = false) => {
    if (!swapContract || !signer) {
      toast({
        title: "Error",
        description: "Wallet not connected",
        variant: "destructive",
      });
      return;
    }

    try {
      // Verify signer matches the current account
      await verifySigner();
      
      // Format values to match contract expectations
      let valueWei;
      if (useRawValue) {
        // If using raw value, parse as a BigInt
        value = value*1000000;
        valueWei = BigInt(String(value).trim());
        console.log("Using raw token value:", valueWei.toString());
      } else {
        // Otherwise convert from ETH to wei
        value = value*1000000;
        valueWei = BigInt(String(value).trim());
        console.log("taking decimal point of 6:", valueWei.toString());
      }
      
      // Ensure buyAssetId is properly formatted as bytes32
      const formattedBuyAssetId = buyAssetId && buyAssetId.startsWith('0x') ? 
        buyAssetId : ethers.ZeroHash;
      
      // Ensure buyLockId is properly formatted as bytes32
      const formattedBuyLockId = buyLockId && buyLockId.startsWith('0x') ? 
        buyLockId : ethers.ZeroHash;
      
      // Convert timeout to integer
      const timeoutInt = Math.floor(Number(timeout));
      
      console.log("Formatted lockSell parameters:", {
        token: tokenAddress,
        recipient,
        hashedSecret,
        timeout: timeoutInt,
        value: valueWei.toString(),
        buyAssetId: formattedBuyAssetId,
        buyLockId: formattedBuyLockId
      });

      // Get token contract
      const tokenContract = await getTokenContract(tokenAddress);
      
      // Check existing allowance
      const currentAllowance = await tokenContract.allowance(account, swapAddress);
      console.log("Current allowance:", currentAllowance.toString(), "needed:", valueWei.toString());
      
      // Only request approval if the current allowance is less than the needed amount
      if (currentAllowance < valueWei) {
        console.log("Approving transfer", {
          token: tokenAddress,
          amount: valueWei.toString(),
          spender: swapAddress
        });
        
        // Request approval for the token transfer
        const approveTx = await tokenContract.approve(swapAddress, valueWei);
        await approveTx.wait();
        
        console.log("Approval confirmed, proceeding with lockSell");
      } else {
        console.log("Token already approved for the required amount");
      }

      // Then call lockSell with properly formatted parameters
      const tx = await swapContract.lockSell(
        tokenAddress,
        recipient,
        hashedSecret,
        timeoutInt,
        valueWei,
        formattedBuyAssetId,
        formattedBuyLockId
      );
      
      toast({
        title: "Transaction Submitted",
        description: "Your lock sell transaction has been submitted",
      });
      
      const receipt = await tx.wait();
      console.log("Transaction receipt:", receipt);
      
      // Extract the lockId from the event if available
      const lockSellEvent = receipt.logs
        .filter(log => log.address.toLowerCase() === swapAddress.toLowerCase())
        .map(log => {
          try {
            return swapContract.interface.parseLog(log);
          } catch (e) {
            return null;
          }
        })
        .find(event => event && event.name === 'LockSell');
      
      // lockSell events might not have a lockId in the contract, adjust if needed
      const lockId = lockSellEvent && lockSellEvent.args.lockId ? 
        lockSellEvent.args.lockId : calculateLockId(tokenAddress, account, hashedSecret, timeoutInt);
        
      console.log("Created sell lock with details:", lockSellEvent ? lockSellEvent.args : null);
      
      toast({
        title: "Lock Sell Created",
        description: "Your lock sell has been successfully created",
      });
      
      return { tx, lockId };
    } catch (error) {
      console.error("Error in lockSell:", error);
      toast({
        title: "Transaction Failed",
        description: error.message,
        variant: "destructive",
      });
      throw error;
    }
  };

  // Unlock function
  const unlock = async (tokenAddress, creator, secret, timeout) => {
    if (!swapContract || !signer) {
      toast({
        title: "Error",
        description: "Wallet not connected",
        variant: "destructive",
      });
      return;
    }

    try {
      // Verify signer matches the current account
      await verifySigner();
      
      // Convert timeout to integer
      const timeoutInt = Math.floor(Number(timeout));
      
      console.log("Formatted unlock parameters:", {
        token: tokenAddress,
        creator,
        secret,
        timeout: timeoutInt
      });
      
      const tx = await swapContract.unlock(tokenAddress, creator, secret, timeoutInt);
      
      toast({
        title: "Transaction Submitted",
        description: "Your unlock transaction has been submitted",
      });
      
      const receipt = await tx.wait();
      console.log("Transaction receipt:", receipt);
      
      toast({
        title: "Lock Unlocked",
        description: "The lock has been successfully unlocked",
      });
      
      return { tx, receipt };
    } catch (error) {
      console.error("Error in unlock:", error);
      toast({
        title: "Transaction Failed",
        description: error.message,
        variant: "destructive",
      });
      throw error;
    }
  };

  // Retrieve function
  const retrieve = async (tokenAddress, recipient, hashedSecret, timeout) => {
    if (!swapContract || !signer) {
      toast({
        title: "Error",
        description: "Wallet not connected",
        variant: "destructive",
      });
      return;
    }

    try {
      // Verify signer matches the current account
      await verifySigner();
    
      // Convert timeout to integer
      const timeoutInt = Math.floor(Number(timeout));
      
      console.log("Formatted retrieve parameters:", {
        token: tokenAddress,
        recipient,
        hashedSecret,
        timeout: timeoutInt
      });
      
      const tx = await swapContract.retrieve(tokenAddress, recipient, hashedSecret, timeoutInt);
      
      toast({
        title: "Transaction Submitted",
        description: "Your retrieve transaction has been submitted",
      });
      
      const receipt = await tx.wait();
      console.log("Transaction receipt:", receipt);
      
      toast({
        title: "Lock Retrieved",
        description: "The lock has been successfully retrieved",
      });
      
      return { tx, receipt };
    } catch (error) {
      console.error("Error in retrieve:", error);
      toast({
        title: "Transaction Failed",
        description: error.message,
        variant: "destructive",
      });
      throw error;
    }
  };

  // Decline function
  const decline = async (tokenAddress, creator, hashedSecret, timeout) => {
    if (!swapContract || !signer) {
      toast({
        title: "Error",
        description: "Wallet not connected",
        variant: "destructive",
      });
      return;
    }

    try {
      // Verify signer matches the current account
      await verifySigner();
      
      // Convert timeout to integer
      const timeoutInt = Math.floor(Number(timeout));
      
      console.log("Formatted decline parameters:", {
        token: tokenAddress,
        creator,
        hashedSecret,
        timeout: timeoutInt
      });
      
      const tx = await swapContract.decline(tokenAddress, creator, hashedSecret, timeoutInt);
      
      toast({
        title: "Transaction Submitted",
        description: "Your decline transaction has been submitted",
      });
      
      const receipt = await tx.wait();
      console.log("Transaction receipt:", receipt);
      
      toast({
        title: "Lock Declined",
        description: "The lock has been successfully declined",
      });
      
      return { tx, receipt };
    } catch (error) {
      console.error("Error in decline:", error);
      toast({
        title: "Transaction Failed",
        description: error.message,
        variant: "destructive",
      });
      throw error;
    }
  };

  // Calculate a lock ID to check the value
  const calculateLockId = (tokenAddress, creator, hashedSecret, timeout) => {
    // This is a simple version - the actual ID calculation should match the smart contract
    return ethers.solidityPackedKeccak256(
      ["address", "address", "bytes32", "uint256"],
      [tokenAddress, creator, hashedSecret, timeout]
    );
  };

  // Get lock value
  const getLockValue = async (lockId) => {
    if (!swapContract) return "0";
    try {
      const value = await swapContract.getLockValue(lockId);
      return ethers.formatEther(value);
    } catch (error) {
      console.error("Error getting lock value:", error);
      return "0";
    }
  };

  // Get token balance for a specific address
  const getTokenBalance = async (tokenAddress) => {
    if (!signer || !account || !provider) return { balance: "0", decimals: 18, symbol: "" };
    
    try {
      // Verify signer matches the current account
      await verifySigner();
      
      // Get token contract
      const tokenContract = await getTokenContract(tokenAddress);
      if (!tokenContract) {
        throw new Error("Failed to create token contract instance");
      }
      
      // Get token info
      let tokenSymbol = "";
      let tokenDecimals = 18;
      
      try {
        tokenSymbol = await tokenContract.symbol();
      } catch (symbolError) {
        console.warn("Could not fetch token symbol:", symbolError);
        tokenSymbol = "???";
      }
      
      try {
        tokenDecimals = await tokenContract.decimals();
      } catch (decimalsError) {
        console.warn("Could not fetch token decimals, assuming 18:", decimalsError);
      }
      
      // Get token balance
      const balance = await tokenContract.balanceOf(account);
      
      return {
        balance: balance.toString(),
        decimals: tokenDecimals,
        symbol: tokenSymbol,
        formatted: ethers.formatUnits(balance, tokenDecimals)
      };
    } catch (error) {
      console.error("Error getting token balance:", error);
      return { balance: "0", decimals: 18, symbol: "", formatted: "0" };
    }
  };

  // Check network connection and return current network info
  const getCurrentNetwork = async () => {
    if (!provider) return null;
    try {
      const network = await provider.getNetwork();
      return {
        chainId: network.chainId,
        name: network.name
      };
    } catch (error) {
      console.error("Error getting network info:", error);
      return null;
    }
  };

  // Fetch historical events from the blockchain
  const fetchPastEvents = async (contract) => {
    if (!contract) {
      console.error("Cannot fetch past events - contract is null");
      return [];
    }

    console.log("Fetching historical events from contract:", contract.target);
    const allEvents = [];
    
    try {
      // Define the event types we want to fetch
      const eventTypes = [
        { name: 'LockBuy', filter: contract.filters.LockBuy() },
        { name: 'LockSell', filter: contract.filters.LockSell() },
        { name: 'Unlock', filter: contract.filters.Unlock() },
        { name: 'Retrieve', filter: contract.filters.Retrieve() },
        { name: 'Decline', filter: contract.filters.Decline() }
      ];
      
      // Set block range - we'll look back a reasonable amount
      // Try multiple methods to get a provider that can fetch a block number
      let providerToUse = null;
      
      // Try the main provider first
      if (provider && typeof provider.getBlockNumber === 'function') {
        providerToUse = provider;
        console.log("Using main provider");
      } 
      // Try the contract's provider next
      else if (contract.provider && typeof contract.provider.getBlockNumber === 'function') {
        providerToUse = contract.provider;
        console.log("Using contract provider");
      }
      // Try to get the provider from the signer
      else if (signer && signer.provider && typeof signer.provider.getBlockNumber === 'function') {
        providerToUse = signer.provider;
        console.log("Using signer provider");
      }
      // Last resort: try to create a new provider if we have a window.ethereum
      else if (window.ethereum) {
        try {
          providerToUse = new ethers.BrowserProvider(window.ethereum);
          console.log("Created new browser provider");
        } catch (e) {
          console.error("Failed to create browser provider:", e);
        }
      }
      
      if (!providerToUse) {
        console.error("No provider available to fetch block number. Proceeding with limited functionality.");
        // Instead of returning empty, we'll try to continue with a limited approach
        // We'll still look for events but without block filtering
        
        // Try to get events without specifying block range
        for (const eventType of eventTypes) {
          console.log(`Attempting to fetch ${eventType.name} events without block range...`);
          
          try {
            // This might work with some providers as they'll use their default range
            const events = await contract.queryFilter(eventType.filter);
            
            console.log(`Found ${events.length} ${eventType.name} events`);
            
            // Process events similar to below...
            for (const event of events) {
              try {
                let formattedEvent = formatEventByType(event, eventType.name);
                if (formattedEvent) {
                  allEvents.push(formattedEvent);
                }
              } catch (eventError) {
                console.error(`Error processing ${eventType.name} event:`, eventError);
              }
            }
          } catch (queryError) {
            console.error(`Error querying ${eventType.name} events without block range:`, queryError);
          }
        }
        
        // Sort events by timestamp
        allEvents.sort((a, b) => b.timestamp - a.timestamp);
        console.log(`Total events fetched without block range: ${allEvents.length}`);
        return allEvents;
      }
      
      // If we have a provider, proceed with block-based filtering
      let currentBlock;
      try {
        currentBlock = await providerToUse.getBlockNumber();
        console.log("Current block number:", currentBlock);
      } catch (blockNumberError) {
        console.error("Error getting block number:", blockNumberError);
        // Try to continue without block filtering as a fallback
        currentBlock = null;
      }
      
      // If we couldn't get the current block, return the fallback approach
      if (currentBlock === null) {
        console.error("Failed to get current block. Trying without block filtering.");
        // Try events without block range (same as above)
        const eventsWithoutRange = await contract.queryFilter(eventTypes[0].filter);
        console.log(`Found ${eventsWithoutRange.length} events without range`);
        return [];
      }
      
      // We have a valid block number, proceed with filtering
      // Look back ~5000 blocks as a more conservative approach (approx. 1 day)
      const fromBlock = Math.max(0, currentBlock - 5000);
      
      console.log(`Fetching events from block ${fromBlock} to ${currentBlock}`);
      
      // Helper function to format event based on type
      const formatEventByType = (event, typeName) => {
        switch (typeName) {
          case 'LockBuy':
            return {
              type: 'LockBuy',
              token: event.args.token,
              creator: event.args.creator,
              recipient: event.args.recipient,
              hashedSecret: event.args.hashedSecret,
              timeout: Number(event.args.timeout),
              value: event.args.value.toString(),
              sellAssetId: event.args.sellAssetId,
              sellPrice: event.args.sellPrice.toString(),
              lockId: event.args.lockId,
              timestamp: Date.now() // Default to current time
            };
          
          case 'LockSell':
            return {
              type: 'LockSell',
              token: event.args.token,
              creator: event.args.creator,
              recipient: event.args.recipient,
              hashedSecret: event.args.hashedSecret,
              timeout: Number(event.args.timeout),
              value: event.args.value.toString(),
              buyAssetId: event.args.buyAssetId,
              buyLockId: event.args.buyLockId,
              timestamp: Date.now() // Default to current time
            };
          
          case 'Unlock':
            return {
              type: 'Unlock',
              token: event.args.token,
              creator: event.args.creator,
              recipient: event.args.recipient,
              lockId: event.args.lockId,
              secret: event.args.secret,
              timestamp: Date.now() // Default to current time
            };
            
          case 'Retrieve':
            return {
              type: 'Retrieve',
              token: event.args.token,
              creator: event.args.creator,
              recipient: event.args.recipient,
              lockId: event.args.lockId,
              timestamp: Date.now() // Default to current time
            };
            
          case 'Decline':
            return {
              type: 'Decline',
              token: event.args.token,
              creator: event.args.creator,
              recipient: event.args.recipient,
              lockId: event.args.lockId,
              timestamp: Date.now() // Default to current time
            };
            
          default:
            return null;
        }
      };
      
      // Fetch each event type
      for (const eventType of eventTypes) {
        console.log(`Fetching ${eventType.name} events...`);
        
        try {
          const events = await contract.queryFilter(
            eventType.filter,
            fromBlock,
            currentBlock
          );
          
          console.log(`Found ${events.length} ${eventType.name} events`);
          
          // Process each event based on its type
          for (const event of events) {
            try {
              let formattedEvent = formatEventByType(event, eventType.name);
              
              if (formattedEvent) {
                // Try to get block timestamp if possible
                try {
                  if (providerToUse) {
                    const block = await providerToUse.getBlock(event.blockNumber);
                    if (block && block.timestamp) {
                      formattedEvent.timestamp = block.timestamp * 1000; // Convert to milliseconds
                    }
                  }
                } catch (blockError) {
                  console.warn(`Could not get block timestamp, using current time:`, blockError);
                }
                
                allEvents.push(formattedEvent);
              }
            } catch (eventError) {
              console.error(`Error processing ${eventType.name} event:`, eventError, event);
            }
          }
        } catch (queryError) {
          console.error(`Error querying ${eventType.name} events:`, queryError);
        }
      }
      
      // Sort events by timestamp, most recent first
      allEvents.sort((a, b) => b.timestamp - a.timestamp);
      
      console.log(`Total events fetched: ${allEvents.length}`);
      return allEvents;
      
    } catch (error) {
      console.error("Error fetching past events:", error);
      return [];
    }
  };

  // Function to manually refresh events
  const refreshEvents = async () => {
    console.log("Manual refresh of events requested");
    
    if (!swapContract || !isConnected) {
      console.error("Cannot refresh events - wallet not connected");
      toast({
        title: "Cannot Refresh Events",
        description: "Wallet is not connected. Please connect your wallet first.",
        variant: "destructive",
      });
      return false;
    }
    
    try {
      // Make sure we have a provider
      const providerToUse = provider || swapContract.provider;
      if (!providerToUse) {
        throw new Error("No provider available to fetch events");
      }
      
      // Re-setup listeners
      listenForEvents(swapContract);
      
      // Fetch past events
      const pastEvents = await fetchPastEvents(swapContract);
      if (pastEvents && pastEvents.length > 0) {
        console.log(`Setting ${pastEvents.length} events from refresh`);
        setEvents(pastEvents);
        
        toast({
          title: "Events Refreshed",
          description: `Found ${pastEvents.length} events`,
        });
        
        return true;
      } else {
        console.log("No events found during refresh");
        setEvents([]);
        
        toast({
          title: "No Events Found",
          description: "No events were found for this contract",
        });
        
        return true;
      }
    } catch (error) {
      console.error("Error refreshing events:", error);
      
      toast({
        title: "Error Refreshing Events",
        description: error.message,
        variant: "destructive",
      });
      
      return false;
    }
  };

  // Connect to wallet on page load if already connected
  useEffect(() => {
    console.log("Blockchain context initialization");
    let cleanupFunctions = [];
    
    // Check for ethereum object with fallbacks for container environments
    const getEthereumProvider = () => {
      if (window.ethereum) return window.ethereum;
      
      // Check for alternate injection methods in Bolt/containers
      const possibleProviders = [
        window.ethereum,
        window.web3?.currentProvider,
        window._ethereum, // Some containers use this
        window.__ethereum // Some containers use this
      ];
      
      for (const provider of possibleProviders) {
        if (provider) {
          console.log("Found alternate ethereum provider:", provider);
          // Add it to window.ethereum for consistency with the rest of the code
          window.ethereum = provider;
          return provider;
        }
      }
      
      return null;
    };
    
    const ethereumProvider = getEthereumProvider();
    
    if (ethereumProvider) {
      console.log("Ethereum provider detected:", Object.keys(ethereumProvider).slice(0, 5));
      
      const checkConnection = async () => {
        try {
          console.log("Checking existing connection");
          
          // Try to create BrowserProvider with retry
          let provider;
          let retryCount = 0;
          
          while (retryCount < 3) {
            try {
              provider = new ethers.BrowserProvider(ethereumProvider);
              break;
            } catch (providerError) {
              console.warn(`Provider creation attempt ${retryCount + 1} failed:`, providerError);
              retryCount++;
              if (retryCount >= 3) {
                console.error("Failed to create provider after 3 attempts");
                return;
              }
              await new Promise(r => setTimeout(r, 500)); // Wait 500ms before retry
            }
          }
          
          // Multiple methods to get accounts in different environments
          const getAccounts = async () => {
            const methods = [
              // Standard ethers method
              async () => provider.listAccounts(),
              // Direct request method
              async () => {
                const accounts = await ethereumProvider.request({ method: 'eth_accounts' });
                return accounts.map(addr => ({ address: addr }));
              },
              // Legacy web3 method
              async () => {
                if (window.web3 && window.web3.eth && window.web3.eth.getAccounts) {
                  return new Promise((resolve, reject) => {
                    window.web3.eth.getAccounts((error, accounts) => {
                      if (error) reject(error);
                      else resolve(accounts.map(addr => ({ address: addr })));
                    });
                  });
                }
                throw new Error("Legacy web3 not available");
              }
            ];
            
            let lastError;
            for (const method of methods) {
              try {
                const accounts = await method();
                if (accounts && accounts.length > 0) return accounts;
              } catch (error) {
                lastError = error;
                console.warn("Account get method failed, trying next method:", error);
              }
            }
            
            console.error("All account get methods failed:", lastError);
            return [];
          };
          
          const accounts = await getAccounts();
          
          console.log("Found accounts:", accounts.length > 0 ? `${accounts.length} accounts` : "No accounts");
          
          if (accounts.length > 0) {
            const network = await provider.getNetwork();
            setChainId(network.chainId);
            console.log("Connected to network:", network.chainId);
            
            const signer = await provider.getSigner();
            console.log("Signer obtained:", signer.address);
            
            const swapContract = new ethers.Contract(swapAddress, swapAbi, signer);
            console.log("Swap contract created at address:", swapAddress);
            
            setProvider(provider);
            setSigner(signer);
            setSwapContract(swapContract);
            setAccount(accounts[0].address);
            setIsConnected(true);
            
            // Start listening for events
            console.log("Initializing event listeners");
            listenForEvents(swapContract);
            
            // Add cleanup function
            cleanupFunctions.push(() => {
              try {
                console.log("Removing event listeners on cleanup");
                swapContract.removeAllListeners();
              } catch (error) {
                console.warn("Error removing listeners during cleanup:", error);
              }
            });
            
            // Fetch past events if possible
            try {
              console.log("Attempting to fetch past events");
              const pastEvents = await fetchPastEvents(swapContract);
              if (pastEvents && pastEvents.length > 0) {
                console.log("Found past events:", pastEvents.length);
                setEvents(pastEvents);
              } else {
                console.log("No past events found during initialization");
              }
            } catch (pastEventsError) {
              console.error("Error fetching past events:", pastEventsError);
            }
          }
        } catch (error) {
          console.error("Error checking connection:", error);
        }
      };
      
      checkConnection();
      
      // Set up wallet event listeners on initial load
      setupWalletEventListeners();
      
      // For sandboxed environments, add polling to detect account changes
      const accountPoll = setInterval(async () => {
        try {
          if (window.ethereum) {
            // Check for accounts
            let accounts;
            let currentChainId;
            
            try {
              // Get accounts
              accounts = await window.ethereum.request({ method: 'eth_accounts' });
              
              // Get current chain ID
              currentChainId = await window.ethereum.request({ method: 'eth_chainId' });
            } catch (requestError) {
              console.warn("Error requesting account/chain data:", requestError);
              return; // Skip this polling cycle if there's an error
            }
            
            // Don't process further if we don't have the necessary data
            if (!accounts) return;
            
            // Account change detection
            if (accounts.length > 0) {
              const currentMetaMaskAccount = accounts[0];
              const currentAppAccount = account;
              
              // Check if there's a mismatch between wallet's active account and our app state
              if (currentMetaMaskAccount && 
                  currentAppAccount && 
                  currentMetaMaskAccount.toLowerCase() !== currentAppAccount.toLowerCase()) {
                
                console.log("Account change detected via polling", {
                  appAccount: currentAppAccount,
                  metaMaskAccount: currentMetaMaskAccount
                });
                
                // Use the handleAccountsChanged function to update the account
                await handleAccountsChanged(accounts);
              } else if (currentMetaMaskAccount && !currentAppAccount) {
                // We have an account in wallet but not in app state (reconnection case)
                console.log("Detected wallet account not in app state, reconnecting");
                await handleAccountsChanged(accounts);
              }
            } else if (account && accounts.length === 0) {
              // User disconnected all accounts in wallet
              console.log("All accounts disconnected in wallet");
              await disconnectWallet();
            }
            
            // Network change detection
            if (currentChainId && chainId) {
              // Convert to comparable format (both BigInt)
              const currentChainIdBigInt = typeof currentChainId === 'string' && currentChainId.startsWith('0x') 
                ? BigInt(currentChainId) 
                : BigInt(currentChainId);
                
              const appChainIdBigInt = typeof chainId === 'bigint' 
                ? chainId 
                : BigInt(chainId.toString());
              
              if (currentChainIdBigInt !== appChainIdBigInt) {
                console.log("Chain change detected via polling", {
                  appChainId: chainId.toString(),
                  walletChainId: currentChainId
                });
                
                // Handle chain change
                await handleChainChanged(currentChainId);
              }
            }
            
            // Additional periodic state refresh - runs roughly every 10 seconds
            // This helps maintain state consistency in container environments
            if (isConnected && account && (Date.now() % 10000 < 1000)) {
              try {
                console.log("Running periodic state verification");
                
                // Verify network
                const provider = new ethers.BrowserProvider(window.ethereum);
                const network = await provider.getNetwork();
                
                // Check if chain ID needs update
                if (network.chainId.toString() !== chainId?.toString()) {
                  console.log("Updating chain ID during periodic check", {
                    oldChainId: chainId,
                    newChainId: network.chainId
                  });
                  setChainId(network.chainId);
                }
                
                // Verify signer matches current account
                if (signer) {
                  const signerAddress = await signer.getAddress();
                  if (signerAddress.toLowerCase() !== account.toLowerCase()) {
                    console.log("Signer address doesn't match current account, reinitializing");
                    await handleAccountsChanged(accounts);
                  }
                }
              } catch (refreshError) {
                console.warn("Error during periodic state refresh:", refreshError);
              }
            }
          }
        } catch (error) {
          console.error("Error in account/network polling:", error);
        }
      }, 1000); // Check every second
      
      // Add cleanup function for the polling interval
      cleanupFunctions.push(() => {
        clearInterval(accountPoll);
        console.log("Cleared account polling interval");
      });
      
      // Add cleanup function for wallet event listeners
      cleanupFunctions.push(() => {
        const ethereumProvider = window.ethereum;
        if (ethereumProvider) {
          // Try multiple ways to remove listeners for different wallet implementations
          const safeRemoveAllListeners = (event) => {
            try {
              // Try standard method first
              if (typeof ethereumProvider.removeAllListeners === 'function') {
                ethereumProvider.removeAllListeners(event);
                console.log(`Removed all listeners for ${event}`);
                return true;
              } else {
                console.warn(`removeAllListeners method not available for ${event}`);
                // Try to remove specific handlers we know about
                if (event === 'accountsChanged') {
                  safeRemoveListener('accountsChanged', handleAccountsChanged);
                  return true;
                } else if (event === 'chainChanged') {
                  safeRemoveListener('chainChanged', handleChainChanged);
                  return true;
                }
              }
              return false;
            } catch (error) {
              console.warn(`Error removing listeners for ${event}:`, error);
              return false;
            }
          };
          
          // Use the same handler references to ensure proper cleanup
          console.log("Removing wallet event listeners");
          const accountsRemoved = safeRemoveAllListeners('accountsChanged');
          const chainRemoved = safeRemoveAllListeners('chainChanged');
          
          // Log cleanup results
          console.log("Wallet event listener cleanup results:", {
            accountsChanged: accountsRemoved ? "success" : "failed",
            chainChanged: chainRemoved ? "success" : "failed"
          });
          
          // Reset stored status
          window._walletEventListenersActive = false;
        }
      });
    } else {
      console.log("No Ethereum provider found");
    }
    
    // Return cleanup function
    return () => {
      console.log("Cleaning up blockchain context");
      cleanupFunctions.forEach(fn => fn());
    };
  }, []);

  const value = {
    provider,
    signer,
    swapContract,
    account,
    isConnected,
    chainId,
    events,
    connectWallet,
    disconnectWallet,
    lockBuy,
    lockSell,
    unlock,
    retrieve,
    decline,
    calculateLockId,
    getLockValue,
    getTokenContract,
    getTokenBalance,
    getCurrentNetwork,
    fetchPastEvents,
    refreshEvents
  };

  return (
    <BlockchainContext.Provider value={value}>
      {children}
    </BlockchainContext.Provider>
  );
} 