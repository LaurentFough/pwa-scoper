import { startNavigation } from "../navigation/background";
startNavigation();
console.log("Background service worker loaded.");

chrome.runtime.onInstalled.addListener(() => {
  console.log("Extension installed.");
});

chrome.action.onClicked.addListener((tab) => {
  console.log("Action clicked", tab);
});
