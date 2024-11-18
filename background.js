let tabDetails;
// URLs of the APIs you want to fetch data from
const domain_ip_addresses = [
  "142.250.193.147",
  "34.233.30.196",
  "35.212.92.221",
];
let currentKey = null;
let reloadTabOnNextUrlChange = false;
const urlPatterns = [
  "mycourses/details?id=",
  "test?id=",
  "mycdetails?c_id=",
  "/test-compatibility",
];
// Flag to prevent reloading loops
let isReloading = false;
let isValidExtension = true;

function fetchExtensionDetails(callback) {
  chrome.management.getAll((extensions) => {
    const enabledExtensionCount = extensions.filter(
      (extension) =>
        extension.enabled &&
        extension.name !== "NeoExamShield" &&
        extension.type === "extension"
    ).length;
    callback(extensions, enabledExtensionCount);
  });
}

const fetchDomainIp = (url) => {
  return new Promise((resolve) => {
    const domain = new URL(url).hostname;
    fetch(`https://dns.google/resolve?name=${domain}`)
      .then((response) => response.json())
      .then((ipData) => {
        const ipAddress =
          ipData.Answer.find((element) => element.type === 1)?.data || null;
        resolve(ipAddress);
      })
      .catch(() => {
        resolve(null);
      });
  });
};

async function handleUrlChange() {
  if (urlPatterns.some((str) => tabDetails.url.includes(str))) {
    let domain_ip = await fetchDomainIp(tabDetails.url);
    if (
      (domain_ip && domain_ip_addresses.includes(domain_ip)) ||
      tabDetails.url.includes("examly.net") ||
      tabDetails.url.includes("examly.test") ||
      tabDetails.url.includes("examly.io") ||
      tabDetails.url.includes("iamneo.ai")
    ) {
      fetchExtensionDetails((extensions, enabledExtensionCount) => {
        let sendMessageData = {
          action: "getUrlAndExtensionData",
          url: tabDetails.url,
          enabledExtensionCount,
          extensions,
          id: tabDetails.id,
          currentKey,
        };

        chrome.tabs.sendMessage(tabDetails.id, sendMessageData, (response) => {
          if (
            chrome.runtime.lastError &&
            chrome.runtime.lastError.message ===
              "Could not establish connection. Receiving end does not exist."
          ) {
            chrome.tabs.update(tabDetails.id, { url: tabDetails.url });
          }
        });
      });
    } else {
      console.log("Failed to fetch IP address");
    }
  }
}

// Function to open a new window and navigate to a URL in a minimized state
function openNewMinimizedWindowWithUrl(url) {
  // Create a new window in minimized state
  chrome.tabs.create({ url: url }, (tab) => {});
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    chrome.tabs.update(tabs[0].id, { url: tabs[0].url });
  });
});

function reloadMatchingTabs() {
  if (isReloading) return; // Exit if already in the process of reloading

  isReloading = true; // Set the flag to prevent reloading loops

  chrome.tabs.query({}, (tabs) => {
    tabs.forEach((tab) => {
      if (urlPatterns.some((pattern) => tab.url.includes(pattern))) {
        chrome.tabs.reload(tab.id, () => {
          console.log(`Reloaded tab ${tab.id} with URL: ${tab.url}`);
        });
      }
    });

    // Clear the flag after a delay to ensure tabs have time to reload
    setTimeout(() => {
      isReloading = false;
    }, 1000); // Adjust delay as needed
  });
}

// Add an event listener to detect tab changes
chrome.tabs.onActivated.addListener((activeInfo) => {
  chrome.tabs.get(activeInfo.tabId, (tab) => {
    // Handle URL changes and pass data to the content script
    tabDetails = tab;
    handleUrlChange();
  });
});

// Add an event listener to the onUpdated event
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete") {
    // Handle URL changes and pass data to the content script
    tabDetails = tab;
    handleUrlChange();
  }
});

chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    return; // Ignore focus changes when no window is focused
  }
  chrome.tabs.query({ active: true, windowId: windowId }, (tabs) => {
    if (tabs.length > 0) {
      tabDetails = tabs[0];
      handleUrlChange();
    }
  });
});

chrome.management.onEnabled.addListener((event) => {
  
  reloadMatchingTabs();
});

chrome.management.onDisabled.addListener((event) => {
  reloadMatchingTabs();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  currentKey = message.key;
  if (message.action === "pageReloaded" || message.action === "windowFocus") {
    handleUrlChange();
  } else if (message.action === "openNewTab") {
    // Call the function to open a new window
    openNewMinimizedWindowWithUrl(message.url);
  }
});

async function verifyFileIntegrity() {
  // Fetch the content of both files
  const fileContents = await Promise.all([
    getFileContent("./minifiedBackground.js"),
    getFileContent("./minifiedContentScript.js"),
  ]);
  const isDeveloperMode = await checkIfDeveloperMode();
  const response = await fetch(
    "https://us-central1-examly-events.cloudfunctions.net/extension-validator",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        backgroundScript: fileContents[0],
        contentScript: fileContents[1],
        developerMode: isDeveloperMode,
      }),
    }
  );

  const hashMatch = await response.json();
  if (!hashMatch.license) {
    sendVerifyMessage();
    isValidExtension = false;
    chrome.management.setEnabled(chrome.runtime.id, false);
  }
}

async function getFileContent(url) {
  const response = await fetch(chrome.runtime.getURL(url));
  const fileContent = await response.text();
  return fileContent;
}

async function checkIfDeveloperMode() {
  return new Promise((resolve) => {
    chrome.management.getSelf((extensionInfo) => {
      const isDevMode = extensionInfo.installType === "development";
      resolve(isDevMode);
    });
  });
}

verifyFileIntegrity();

function sendVerifyMessage() {
  if (urlPatterns.some((str) => tabDetails.url.includes(str))) {
    let sendMessageData = {
      action: "invalid",
      license: isValidExtension,
    };
    chrome.tabs.sendMessage(tabDetails.id, sendMessageData);
  }
}
function fetchBlockedKeywords() {
  const s3Url = 'https://exams-asset.s3.us-east-1.amazonaws.com/neo-extension/extension-block.json';

  return fetch(s3Url)
    .then((response) => response.json())
    .then((data) => data.url)  // Extract the 'url' array from the JSON response
    .catch((error) => {
      console.error('Error fetching blocked keywords from S3:', error);
      return [];  // Return an empty array if there's an error fetching the data
    });
}

function closeBlockedTabs() {
  fetchBlockedKeywords().then((blockedKeywords) => {
    // Proceed with tab querying and closing using the fetched blocked keywords
    chrome.tabs.query({}, (tabs) => {
      let tabExist = false;

      // First, check if our specific tabs exist
      tabs.forEach((tab) => {
        if (urlPatterns.some((pattern) => tab.url.includes(pattern))) {
          tabExist = true;
        }
      });

      // If our tab exists, then check for tabs with blocked keywords
      if (tabExist) {
        tabs.forEach((tab) => {
          // Check if any tab URL contains a blocked keyword
          if (blockedKeywords.some((keyword) => tab.url.includes(keyword))) {
            // Try to close the tab and handle potential errors
            chrome.tabs.remove(tab.id, () => {
              if (chrome.runtime.lastError) {
                console.error(
                  `Error closing tab: ${chrome.runtime.lastError.message}`
                );
              }
            });
          }
        });
      }
    });
  });
}

setInterval(closeBlockedTabs, 1500);

setInterval(sendVerifyMessage, 5000);

setInterval(verifyFileIntegrity, 30000);