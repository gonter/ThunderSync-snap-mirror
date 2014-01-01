//
// XPCOM component for handling startup and shutdown
// by Frank Abelbeck
//
// https://developer.mozilla.org/en/How_to_Build_an_XPCOM_Component_in_Javascript
//
// $Id: ThunderSyncAutoSync.js 50 2013-11-04 21:48:23Z frank $
//

Components.utils.import("resource://gre/modules/XPCOMUtils.jsm");

function ThunderSyncAutoSync() { this.wrappedJSObject = this; }

ThunderSyncAutoSync.prototype = {
	classDescription: "ThunderSync XPCOM Component for AutoSync",
	classID: Components.ID("{d96fc134-9e83-439b-a291-d866dc508289}"),
	contractID: "@abelbeck.wordpress.com/ThunderSync/AutoSync;1",
	_xpcom_categories: [{category: "app-startup", service: true}], // Gecko 1.9.2 compatibility
	QueryInterface: XPCOMUtils.generateQI([Components.interfaces.nsIObserver,Components.interfaces.nsISupportWeakReference]),
	
	observe: function (aSubject,aTopic,aData) {
		var observerService = Components.classes["@mozilla.org/observer-service;1"]
					.getService(Components.interfaces.nsIObserverService);
		var prefs = Components.classes["@mozilla.org/preferences-service;1"]
				.getService(Components.interfaces.nsIPrefService)
				.getBranch("extensions.ThunderSync.");
		switch (aTopic) {
			case "app-startup":
				try {
					observerService.addObserver(this, "profile-after-change", false);
				} catch (exception) {
					this.logMsg(exception);
				}
				break;
				
			case "profile-after-change":
				try {
					observerService.addObserver(this, "quit-application", false);
				} catch (exception) {
					this.logMsg(exception);
				}
				// fix preferences from versions prior to 2.x
				this.fixPreferences();
				
				// ensure photo directory is present in profile
				// construct path to Thunderbird's Photos directory
				var photoDir = Components
					.classes["@mozilla.org/file/directory_service;1"]
					.getService(Components.interfaces.nsIProperties)
					.get("ProfD", Components.interfaces.nsIFile);
				photoDir.append("Photos");
				if (!photoDir.exists()) {
					photoDir.create(Components.interfaces.nsIFile.DIRECTORY_TYPE, 0775);
				}
				
				// make sure all addressbook entries in all addressbooks have a UID:
				//   iterate over all entries and look for UIDs;
				//   if none is set, generate one.
				var uuidgenerator = Components.classes["@mozilla.org/uuid-generator;1"].getService(Components.interfaces.nsIUUIDGenerator);
				var addressBooks = Components.classes["@mozilla.org/abmanager;1"].getService(Components.interfaces.nsIAbManager).directories;
				while (addressBooks.hasMoreElements()) {
					// get next item in list; skip if it's not an addressbook
					var addressBook = addressBooks.getNext();
					if (!(addressBook instanceof Components.interfaces.nsIAbDirectory) || addressBook.isMailList) { continue; }
					var localUID = "";
					var cards = addressBook.childCards;
					while (cards.hasMoreElements()) {
						var card = cards.getNext();
						if (!(card instanceof Components.interfaces.nsIAbCard) || card.isMailList) { continue; }
						localUID = card.getProperty("UID","");
						if (localUID == "") {
							// undefined UID: create new one and apply changes
							card.setProperty("UID",uuidgenerator.generateUUID().toString().slice(1,37));
							addressBook.modifyCard(card);
						}
					}
				}
				
				// check if start-up sync should be done
				var action = false;
				// first: get list of addressbooks
				var obj = new Object();
				var abooks = prefs.getChildList("Addressbooks.",obj);
				for (i=0;i<abooks.length;i++) {
					// obtain name from key list ["Addressbooks.Name1","Addressbooks.Name",...]
					var abName = abooks[i].substr(13);
					// look for path (stored in obj[Addressbook.NameX])
					// if no path is defined: continue with next book
					try {
						var path = prefs.getCharPref(abooks[i],"");
						if (path == "") { continue; }
					} catch (exception) {
						continue;
					}
					// examine sync mode: if it equals ask|export|import,
					// set action = true and exit loop
					try {
						var syncMode = prefs.getCharPref("startUp."+abName,"");
						if ((syncMode == "ask") || (syncMode == "export") || (syncMode == "import")) {
							action = true;
							break;
						}
					} catch (exception) {
						continue;
					}
				}
				if (action) { this.doSync("startUp"); }
				break;
				
			case "quit-application":
				try {
					observerService.removeObserver(this, "profile-after-change");
				} catch (exception) {}
				observerService.removeObserver(this, "quit-application");
				
				// check if shut-down sync should be done
				var action = false;
				// first: get list of addressbooks
				var obj = new Object();
				var abooks = prefs.getChildList("Addressbooks.",obj);
				for (i=0;i<abooks.length;i++) {
					// obtain name from key list ["Addressbooks.Name1","Addressbooks.Name",...]
					var abName = abooks[i].substr(13);
					
					// look for path (stored in obj[Addressbook.NameX])
					// if no path is defined: continue with next book
					try {
						var path = prefs.getCharPref(abooks[i],"");
						if (path == "") { continue; }
					} catch (exception) {
						continue;
					}
					// examine sync mode: if it equals ask|export|import,
					// set action = true and exit loop
					try {
						var syncMode = prefs.getCharPref("shutdown."+abName,"");
						if ((syncMode == "ask") || (syncMode == "export") || (syncMode == "import")) {
							action = true;
							break;
						}
					} catch (exception) {
						continue;
					}
				}
				if (action) { this.doSync("shutdown"); }
				break;
		}
	},
	
	/**
	 * Write a message to Thunderbird's error console
	 * 
	 * @param msg message string
	 */
	logMsg: function (msg) {
		Components.classes["@mozilla.org/consoleservice;1"]
			.getService(Components.interfaces.nsIConsoleService)
			.logStringMessage("[ThunderSync/AutoSync] "+msg);
	},
	
	doSync: function (mode) {
		try {
			var window = Components.classes["@mozilla.org/embedcomp/window-watcher;1"]
					.getService(Components.interfaces.nsIWindowWatcher);
			var arguments = { mode:mode };
			arguments.wrappedJSObject = arguments;
			var dialog = window.openWindow(
					null,
					'chrome://thundersync/content/ThunderSyncDialog.xul',
					'',
					'chrome,centerscreen,modal,alwaysRaised,dialog',
				  	arguments
			);
		} catch (exception) {
			this.logMsg("ThunderSync/AutoSync: "+exception);
		}
	},
	
	/**
	 * fix "old" preferences, i.e. update from 1.x to 2.x
	 */
	fixPreferences: function () {
		var prefs = Components.classes["@mozilla.org/preferences-service;1"]
				.getService(Components.interfaces.nsIPrefService)
				.getBranch("extensions.ThunderSync.");
		
		//
		// get, store and clear old sync-on-startup preference
		// if not of type PREF_STRING or PREF_BOOL: preference not set
		//
		var syncOnStartup = null;
		var prefType = prefs.getPrefType("syncOnStartup");
		switch (prefType) {
			case prefs.PREF_BOOL:
				if (prefs.getBoolPref("syncOnStartup")) {
					var syncOnStartup = "ask";
				} else {
					var syncOnStartup = "no";
				}
				break;
			case prefs.PREF_STRING:
				syncOnStartup = prefs.getCharPref("syncOnStartup")
				if (syncOnStartup != "ask" && syncOnStartup != "export" && syncOnStartup != "import" &&
					syncOnStartup != "forced export" && syncOnStartup != "forced import" ) {
					syncOnStartup = "no";
				}
				break;
		}
		try { prefs.clearUserPref("syncOnStartup"); } catch (exception) {}
		
		//
		// get, store and clear old sync-on-shutdown preference
		// if not of type PREF_STRING or PREF_BOOL: preference not set
		//
		var syncOnShutdown = null;
		var prefType = prefs.getPrefType("syncOnShutdown");
		switch (prefType) {
			case prefs.PREF_BOOL:
				if (prefs.getBoolPref("syncOnShutdown")) {
					syncOnShutdown = "ask";
				} else {
					syncOnShutdown = "no";
				}
				break;
			case prefs.PREF_STRING:
				syncOnShutdown = prefs.getCharPref("syncOnShutdown")
				if (syncOnShutdown != "ask" && syncOnShutdown != "export" && syncOnShutdown != "import" &&
					syncOnShutdown != "forced export" && syncOnShutdown != "forced import" ) {
					syncOnShutdown = "no";
				}
				break;
		}
		try { prefs.clearUserPref("syncOnShutdown"); } catch (exception) {}
		
		//
		// get, store and clear old export format preference
		// if not of type PREF_STRING: preference not set
		//
		var exportFormat = null;
		if (prefs.getPrefType("exportFormat") == prefs.PREF_STRING) {
			exportFormat = prefs.getCharPref("exportFormat");
			if (exportFormat != "vCardFile") {
				exportFormat = "vCardDir";
			}
		}
		try { prefs.clearUserPref("exportFormat"); } catch (exception) {}
		
		//
		// get, store and clear old export encoding preference
		// if not of type PREF_STRING: preference not set
		//
		var vCardExportEncoding = null;
		if (prefs.getPrefType("exportEncoding") == prefs.PREF_STRING) {
			vCardExportEncoding = prefs.getCharPref("exportEncoding");
			if (["Standard", "ISO-8859-1", "ISO-8859-2", "ISO-8859-3",
				"ISO-8859-4", "ISO-8859-5", "ISO-8859-6", "ISO-8859-7",
				"ISO-8859-8", "ISO-8859-9", "ISO-8859-10", "ISO-8859-11",
				"ISO-8859-13", "ISO-8859-14", "ISO-8859-15", "ISO-8859-16",
				"Windows-874", "Windows-932", "Windows-936", "Windows-949",
				"Windows-950", "Windows-1250", "Windows-1251", "Windows-1252",
				"Windows-1253", "Windows-1254", "Windows-1255", "Windows-1256",
				"Windows-1257", "Windows-1258", "UTF-8"].indexOf(vCardExportEncoding) == -1) {
				vCardExportEncoding = "UTF-8";
			}
		}
		try { prefs.clearUserPref("exportEncoding"); } catch (exception) {}
		
		//
		// get, store and clear old import encoding preference
		// if not of type PREF_STRING: preference not set
		//
		var vCardImportEncoding = null;
		if (prefs.getPrefType("importEncoding") == prefs.PREF_STRING) {
			vCardImportEncoding = prefs.getCharPref("importEncoding");
			if (["Standard", "ISO-8859-1", "ISO-8859-2", "ISO-8859-3",
				"ISO-8859-4", "ISO-8859-5", "ISO-8859-6", "ISO-8859-7",
				"ISO-8859-8", "ISO-8859-9", "ISO-8859-10", "ISO-8859-11",
				"ISO-8859-13", "ISO-8859-14", "ISO-8859-15", "ISO-8859-16",
				"Windows-874", "Windows-932", "Windows-936", "Windows-949",
				"Windows-950", "Windows-1250", "Windows-1251", "Windows-1252",
				"Windows-1253", "Windows-1254", "Windows-1255", "Windows-1256",
				"Windows-1257", "Windows-1258", "UTF-8"].indexOf(vCardImportEncoding) == -1) {
				vCardImportEncoding = "Standard";
			}
		}
		try { prefs.clearUserPref("importEncoding"); } catch (exception) {}
		
		// if any preference was read, we need to update global preferences
		// to addressbook-specific preferences
		var obj = new Object();
		var abooks = prefs.getChildList("Addressbooks.",obj);
		for (i=0;i<abooks.length;i++) {
			var abName = abooks[i].substr(13);
			// convert old entries
			if (syncOnStartup != null) {
				prefs.setCharPref("startUp."+abName,syncOnStartup);
			}
			if (syncOnShutdown != null) {
				prefs.setCharPref("shutdown."+abName,syncOnShutdown);
			}
			if (exportFormat != null) {
				prefs.setCharPref("exportFormat."+abName,exportFormat);
			}
			if (vCardExportEncoding != null) {
				prefs.setCharPref("vCard.exportEncoding."+abName,vCardExportEncoding);
			}
			if (vCardImportEncoding != null) {
				prefs.setCharPref("vCard.importEncoding."+abName,vCardImportEncoding);
			}
			
			// check paths: are they valid, are they URIs?
			try {
				format = prefs.getCharPref("exportFormat."+abName);
			} catch (exception) {
				format = exportFormat;
			}
			try {
				path = prefs.getCharPref("Addressbooks."+abName);
			} catch (exception) {
				path = "";
			}
			
			switch (format) {
				case "vCardDir":
				case "vCardFile":
					try {
						// try to load file as if it were a native path string
						// (e.g. /home/user/vcard)
						var pathFile = Components.classes["@mozilla.org/file/local;1"]
								.createInstance(Components.interfaces.nsIFile);
						pathFile.initWithPath(path);
						// convert path to a URI
						path = Components.classes["@mozilla.org/network/io-service;1"]
							.getService(Components.interfaces.nsIIOService)
							.newFileURI(pathFile).spec;
					} catch (exception) {
						// something went wrong; most propable cause:
						// path is already a URI
						try {
							var pathFile = Components.classes["@mozilla.org/network/io-service;1"]
									.getService(Components.interfaces.nsIIOService)
									.newURI(path,null,null)
									.QueryInterface(Components.interfaces.nsIFileURL)
									.file;
						} catch (exception) {
							// it wasn't a URI either: reset
							var pathFile = null;
							path = "";
						}
					}
					if ((format == "vCardDir") && pathFile &&
					     (  !pathFile.exists() || !pathFile.isDirectory() )
					) {
						// vCardDir needs an existing directory
						// if path points to a nonexisting file or
						// if path points to a file that is not a directory or
						// if a file object could not be constructed:
						// reset path
						path = "";
					}
					break;
				default:
					path = "";
			}
			// write back path
			prefs.setCharPref("Addressbooks."+abName,path);
			
			// check new entry: syncMode
			if (prefs.getPrefType("syncMode."+abName) == prefs.PREF_STRING) {
				var syncMode = prefs.getCharPref("syncMode."+abName);
			} else {
				var syncMode = null;
			}
			if (syncMode != "no" && syncMode != "export" && syncMode != "import" &&
				syncMode != "forced export" && syncMode != "force import") {
				prefs.setCharPref("syncMode."+abName,"ask");
			}
			
			// check new entry: UID as comment?
			if (prefs.getPrefType("vCard.hideUID."+abName) != prefs.PREF_BOOL) {
				prefs.setBoolPref("vCard.hideUID."+abName,false);
			}
			
			// check new entry: enable quoted-printable encoding?
			if (prefs.getPrefType("vCard.quotedPrintable."+abName) != prefs.PREF_BOOL) {
				prefs.setBoolPref("vCard.quotedPrintable."+abName,true);
			}
			
			// check new entry: enable line folding?
			if (prefs.getPrefType("vCard.folding."+abName) != prefs.PREF_BOOL) {
				prefs.setBoolPref("vCard.folding."+abName,true);
			}
			
			// check new entry: filters?
			if (prefs.getPrefType("filter."+abName) != prefs.PREF_STRING) {
				prefs.setCharPref("filter."+abName,"");
			}
		}
	}

}

if(XPCOMUtils.generateNSGetFactory) {
	// Gecko 2.0 and newer
	var NSGetFactory = XPCOMUtils.generateNSGetFactory([ThunderSyncAutoSync]);
} else {
	// Gecko 1.9.2 compatibility
	var NSGetModule = XPCOMUtils.generateNSGetModule([ThunderSyncAutoSync]);
}

