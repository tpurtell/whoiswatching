WhoIsWatching = {

1: function () {
  gBrowser.selectedTab = gBrowser.addTab("chrome://whoiswatching/content/watchers.html");
}};

function WhoIsWatchingHooks() {

  var logger = Components.classes['@mozilla.org/consoleservice;1'].
    getService(Components.interfaces.nsIConsoleService);
  
  var mainWindow = window.QueryInterface(Components.interfaces.nsIInterfaceRequestor)
                         .getInterface(Components.interfaces.nsIWebNavigation)
                         .QueryInterface(Components.interfaces.nsIDocShellTreeItem)
                         .rootTreeItem
                         .QueryInterface(Components.interfaces.nsIInterfaceRequestor)
                         .getInterface(Components.interfaces.nsIDOMWindow);
  
  //TODO: collapse according to ontogology
  function updateTally(tally, words) {
    for(var i = 0; i < words.length; ++i) {
      var w = words[i].toLowerCase();
      if(w in tally) {
        ++tally[w];
      } else {
        tally[w] = 1;
      }
    }
  }
  //TODO: subject detection
  var common = [
    "the", "and", "a", "or", "then", "an", "is", "to", "of", "in", "be", "if", "has", "you", "me", "i",
  ];
  function collapseTally(tally) {
    var bestWords = [];
    for(var i = 0; i < common.length; ++i) {
      delete tally[common[i]];
    }
    while(bestWords.length < 20) {
      var best = 0;
      var bestWord;
      for(var w in tally) {
        any = true;
        if(tally[w] > best) {
          bestWord = w;
          best = tally[w];
        }
      }
      if(best === 0)
        break;
      bestWords.push(bestWord);
      delete tally[bestWord];
    }
    return bestWords;
  }
  function getHumanText(node) {
      var text = "";
      var children = node.childNodes
      for(var i = 0; i < children.length; ++i) {
        var child = children[i];
        if(child.nodeType == Node.TEXT_NODE) {
          text += child.nodeValue;
        } else if(child.nodeType == Node.ELEMENT_NODE) {
          var tag = child.nodeName.toLowerCase();
          if(tag == "script" || tag == "code" || tag == "style")
            continue;
          text += getHumanText(child);
        }
      }
      return text;
  } 
  var re_domain = /^https?:\/\/([^\/]+).*/; 
  function domainFromUri(uri) {
    return uri.match(re_domain)[1];
  }
  var re_shortdomain = /([^\.]+.[^\.]+)$/; 
  function shortDomain(domain) {
    return domain.match(re_shortdomain)[1];
  }
  
  function Tracker() {
    var file = Components.classes["@mozilla.org/file/directory_service;1"]
                         .getService(Components.interfaces.nsIProperties)
                         .get("ProfD", Components.interfaces.nsIFile);
    file.append("whoiswatching" + ".sqlite");

    var storageService = Components.classes["@mozilla.org/storage/service;1"]
                            .getService(Components.interfaces.mozIStorageService);
    this.db = storageService.openDatabase(file); // Will also create the file if it does not exist
    
    var version = 1;
    var db_version = 0;
    //if the table doesn't exist then we should update
    try {
        var st_version = this.db.createStatement("SELECT version FROM versions");
        while(st_version.step()) {
            db_version = st_version.row.version;
        }
        st_version.finalize();
    } catch(e) {}

    if(db_version != version) {
        this.db.beginTransaction();
        var st_table = this.db.createStatement("SELECT name FROM sqlite_master WHERE type='table'");
        var tables = [];
        while(st_table.step()) {
            tables.push(st_table.row.name);
        }
        for(var i = 0; i < tables.length; ++i) {
            try { this.db.executeSimpleSQL("DROP TABLE " + tables[i]); } catch(e) {}
        }
        this.db.commitTransaction();
        this.db.executeSimpleSQL("VACUUM");
    }
    this.db.beginTransaction();
    try {
        if(!this.db.tableExists("versions")) {
            var fields = [
                "version INTEGER UNIQUE"
            ];        
            this.db.createTable("versions", fields.join(", "));
            this.db.executeSimpleSQL("INSERT INTO versions (version) VALUES (" + version + ") ");
        }
        if(!this.db.tableExists("visited")) {
            var fields = [
                "visit_id INTEGER PRIMARY KEY",
                "uri TEXT",
                "domain TEXT",
                "short_domain TEXT",
                "visit_time INTEGER", 
            ];        
            this.db.createTable("visited", fields.join(", "));
            this.db.executeSimpleSQL("CREATE UNIQUE INDEX visited_by_visit_id ON visited (visit_id)");
            this.db.executeSimpleSQL("CREATE INDEX visited_by_uri ON visited (uri)");
            this.db.executeSimpleSQL("CREATE INDEX visited_by_short_domain ON visited (short_domain)");
            this.db.executeSimpleSQL("CREATE INDEX visited_by_domain ON visited (domain)");
        }
        if(!this.db.tableExists("watched")) {
            var fields = [
                "visit_id INTEGER",
                "short_domain TEXT",
                "domain TEXT",
            ];
            this.db.createTable("watched", fields.join(", "));
            this.db.executeSimpleSQL("CREATE UNIQUE INDEX watched_by_pair ON watched (visit_id, domain)");
            this.db.executeSimpleSQL("CREATE INDEX watched_by_domain ON watched (domain)");
            this.db.executeSimpleSQL("CREATE INDEX watched_by_short_pair ON watched (visit_id, short_domain)");
            this.db.executeSimpleSQL("CREATE INDEX watched_by_short_domain ON watched (short_domain)");
        }
        this.db.commitTransaction();
    } catch(e) {
        this.db.rollbackTransaction();
        throw e;
    }
    this.st_visits_to_domain = this.db.createStatement("SELECT COUNT(visit_id) AS count FROM visited WHERE domain = :domain");
    this.st_visits_to_short_domain = this.db.createStatement("SELECT COUNT(visit_id) AS count FROM visited WHERE short_domain = :domain");
    this.st_visits_to_uri = this.db.createStatement("SELECT COUNT(visit_id) AS count FROM visited WHERE uri = :uri");
    this.st_visits = this.db.createStatement("SELECT COUNT(visit_id) AS count FROM visited");

    this.st_watched_domain = this.db.createStatement("SELECT watched.domain, COUNT(visited.visit_id) AS count FROM visited JOIN watched ON visited.visit_id = watched.visit_id WHERE visited.domain = :domain");
    this.st_watched_short_domain = this.db.createStatement("SELECT watched.domain, COUNT(visited.visit_id) AS count FROM visited JOIN watched ON visited.visit_id = watched.visit_id WHERE visited.short_domain = :domain");
    this.st_short_watched_short_domain = this.db.createStatement("SELECT watched.short_domain AS domain, COUNT(visited.visit_id) AS count FROM visited JOIN watched ON visited.visit_id = watched.visit_id WHERE visited.short_domain = :domain");
    this.st_watched_uri = this.db.createStatement("SELECT watched.domain, COUNT(visited.visit_id) AS count FROM visited JOIN watched ON visited.visit_id = watched.visit_id WHERE uri = :uri");
    this.st_short_watched_uri = this.db.createStatement("SELECT watched.short_domain AS domain, COUNT(visited.visit_id) AS count FROM visited JOIN watched ON visited.visit_id = watched.visit_id WHERE uri = :uri");

    this.st_domains_watched = this.db.createStatement("SELECT visited.domain, COUNT(visited.visit_id) AS count FROM visited JOIN watched ON visited.visit_id = watched.visit_id WHERE watched.domain = :domain");
    this.st_domains_short_watched = this.db.createStatement("SELECT visited.domain, COUNT(visited.visit_id) AS count FROM visited JOIN watched ON visited.visit_id = watched.visit_id WHERE watched.short_domain = :domain");
    this.st_short_domains_short_watched = this.db.createStatement("SELECT visited.short_domain AS domain, COUNT(visited.visit_id) AS count FROM visited JOIN watched ON visited.visit_id = watched.visit_id WHERE watched.short_domain = :domain");
    
    
    this.st_short_watcher_domain_stats = this.db.createStatement("SELECT watched.short_domain AS domain, COUNT(DISTINCT watched.visit_id) AS count FROM watched JOIN visited ON watched.visit_id = visited.visit_id WHERE watched.short_domain <> visited.short_domain GROUP BY watched.short_domain ORDER BY count DESC LIMIT 100");

    this.st_short_watcher_total = this.db.createStatement("SELECT COUNT(DISTINCT watched.visit_id) AS count FROM watched JOIN visited ON watched.visit_id = visited.visit_id WHERE watched.short_domain <> visited.short_domain");

    this.st_insert_visit = this.db.createStatement("INSERT INTO visited (uri, domain, short_domain, visit_time) VALUES (:uri, :domain, :short_domain, :visit_time);");
    this.st_insert_watch = this.db.createStatement("INSERT OR IGNORE INTO watched (visit_id, domain, short_domain) VALUES (:visit_id, :domain, :short_domain);");
  }
  
  Tracker.prototype = {
    re_word:/\b\w+\b/g,
    dependents: {},
    pages: {},
    viewPage:function(window, document, uri) {
      try {
        domainFromUri(uri);
      } catch(err) {
        return;
      }
      this.pages[uri] = null;
      if(document.body) {
        this.loadedPage(document, uri);
      } else {
        var tracker = this;
        var callback_ref = {};
        callback_ref.callback = function() { 
          tracker.loadedPage(document, uri); 
          window.removeEventListener("load", callback_ref.callback, false);
        }
        window.addEventListener("load", callback_ref.callback, false);
      }
    },
    loadedPage:function(document, uri) {
      var words = {};
      try { 
        //TODO: use body text once reasonable best word capabilities exist
        // var text = getHumanText(document.documentElement);
        var text = document.title;
        var results = text.match(this.re_word);
        if(results)
          updateTally(words, results);
      } catch(err) {logger.logStringMessage(err);}

      if(!"body" in document)
        return;
      var now = new Date();
      this.st_insert_visit.params["uri"] = uri;
      this.st_insert_visit.params["domain"] = domainFromUri(uri);
      this.st_insert_visit.params["short_domain"] = shortDomain(domainFromUri(uri));
      this.st_insert_visit.params["visit_time"] = now.getTime();
      while(this.st_insert_visit.step()) {};
      this.pages[uri] = {
        words:collapseTally(words),
        visit_id:this.db.lastInsertRowID,
      }

      // logger.logStringMessage(
      //   "doc: " + document.title + 
      //   "\nuri: " + uri + "\nwords: " + 
      //   JSON.stringify(this.pages[uri].words));
      if(uri in this.dependents) {
        for(var i in this.dependents[uri]) {
          var target = this.dependents[uri][i];
          // logger.logStringMessage("req: " + target + "\nsees: " + uri + "\n:" + JSON.stringify(this.pages[uri].words));
          this.st_insert_watch.params["visit_id"] = this.pages[uri].visit_id;
          this.st_insert_watch.params["domain"] = domainFromUri(target);
          this.st_insert_watch.params["short_domain"] = shortDomain(domainFromUri(target));
          while(this.st_insert_watch.step()) {};
        }
        delete this.dependents[uri];
      }
    },
    fetchRelated:function(document, source, target) {
      try {
        //internal fetches are not disallowed
        if(domainFromUri(source) == domainFromUri(target))
          return;
      } catch(err) {
        return;
      }
      //don't chain
      if(!(source in this.pages)) 
        return;
      if(this.pages[source] !== null) {
        // logger.logStringMessage("req: " + target + "\nsees: " + source + "\n:" + JSON.stringify(this.pages[source].words));
        this.st_insert_watch.params["visit_id"] = this.pages[source].visit_id;
        this.st_insert_watch.params["domain"] = domainFromUri(target);
        this.st_insert_watch.params["short_domain"] = shortDomain(domainFromUri(target));
        while(this.st_insert_watch.step()) {};
      } else {
        if(source in this.dependents) {
          this.dependents[source].push(target);
        } else {
          this.dependents[source] = [ target ];
        }
      }
    },
    getTopWatchers:function() {
      var total_visits = 0;
      while(this.st_visits.step()) {
        total_visits = this.st_visits.row.count;
      }
      if(total_visits == 0)
        return [];
      var watchers = [];
      while(this.st_short_watcher_domain_stats.step()) {
        var c = this.st_short_watcher_domain_stats.row.count;
        watchers.push({
          domain:this.st_short_watcher_domain_stats.row.domain,
          fraction:(c / total_visits),
        });
      };
      return watchers;
    },
    getFractionWatched:function() {
      var total_visits = 0;
      while(this.st_visits.step()) {
        total_visits = this.st_visits.row.count;
      }
      if(total_visits == 0)
        return [{domain:"--none--", fraction:0.0}];
      while(this.st_short_watcher_total.step()) {
        watched_visits = this.st_short_watcher_total.row.count;
      }

      return watched_visits / total_visits;
    },
  }
  var tracker = new Tracker();
  gWhoIsWatchingTracker = tracker;
  function WhoIsWatchingListener(tracker) {
    this.tracker = tracker;
    var listener = this;
    var installWatcher = mainWindow.setTimeout(
      function() {
        try {
          gBrowser.addTabsProgressListener(listener);
          logger.logStringMessage('!!watching events');
          mainWindow.clearTimeout(installWatcher);
        } catch(err) {}
      }, 50);
  }
  
  WhoIsWatchingListener.prototype = {
    onLocationChange: function(
      /*nsIDOMXULElement*/ aBrowser,
      /*nsIWebProgress*/ webProgress,
      /*nsIRequest*/ request,
      /*nsIURI*/ location) 
    {
      try {
        tracker.viewPage(aBrowser.contentWindow, aBrowser.contentDocument, aBrowser.currentURI.spec);
      } catch(err) {
        logger.logStringMessage(err);
      }
    },
    onProgressChange: function(
      /*nsIDOMXULElement*/ aBrowser,
      /*nsIWebProgress*/ webProgress,
      /*nsIRequest*/ request,
      /*PRInt32*/ curSelfProgress,
      /*PRInt32*/ maxSelfProgress,
      /*PRInt32*/ curTotalProgress,
      /*PRInt32*/ maxTotalProgress) 
    {
    },
    onSecurityChange: function(
      /*nsIDOMXULElement*/ aBrowser,
      /*nsIWebProgress*/ aWebProgress,
      /*nsIRequest*/ aRequest,
      /*unsigned long*/ aStateFlags,
      /*nsresult*/ aStatus) 
    {
    
    },
    onStateChange: function(
      /*nsIDOMXULElement*/ aBrowser,
      /*nsIWebProgress*/ aWebProgress,
      /*nsIRequest*/ aRequest,
      /*nsresult*/ aStatus,
      /*PRUnichar* */ aMessage) 
    {
    
    },
    onStatusChange: function(
      /*nsIDOMXULElement*/ aBrowser,
      /*nsIWebProgress*/ webProgress,
      /*nsIURI*/ aRefreshURI,
      /*long*/ aMillis,
      /*boolean*/ aSameURI) 
    {
    
    },
  };
  var listener = new WhoIsWatchingListener(tracker);
  
  
  function WhoIsWatchingObserver(tracker) {
    this.tracker = tracker;
    this.observerService = Components.classes["@mozilla.org/observer-service;1"]
                     .getService(Components.interfaces.nsIObserverService);
    this.register();
  }
  WhoIsWatchingObserver.prototype = {
    //TODO: XHRs? different header?
    observe: function(subject, topic, data)
    {
      if (topic == "http-on-modify-request") {
        var httpChannel, interfaceRequestor;
        
        try {
          httpChannel = subject.QueryInterface(Components.interfaces.nsIHttpChannel);
          interfaceRequestor = httpChannel.notificationCallbacks.QueryInterface(
            Components.interfaces.nsIInterfaceRequestor);
        } catch(err) {
          return;
        }

        var uri, referrer;
        try { 
          uri = httpChannel.URI.spec;
          referrer = httpChannel.getRequestHeader("Referer");
        } catch(err) {
          return;
        }
        
        try {
          var domWindow = interfaceRequestor.getInterface(Components.interfaces.nsIDOMWindow);
          tracker.fetchRelated(domWindow.document, referrer, uri);
        } catch(err) {
          return;
        }
      }
    },
    register: function()
    {
      this.observerService.addObserver(this, "http-on-modify-request", false);
    },
    unregister: function()
    {
      this.observerService.removeObserver(this, "http-on-modify-request");
    }
  };
  var observer = new WhoIsWatchingObserver();
  
  
  const prefService = Cc["@mozilla.org/preferences-service;1"];
  const prefs = prefService.getService(Components.interfaces.nsIPrefBranch2);

  var perfDomain = "whoiswatching.extension";
  function appendToToolbar() {
    try {
      if (prefs.getBoolPref(prefDomain, "installed_button"))
        return;
    } catch(err) {}

    prefs.setBoolPref(perfDomain, "installed_button", true);

    var buttonId = "watching-button";
    var navBar = document.getElementById("nav-bar");
    var currentSet = navBar.currentSet;

    // Append only if the button is not already there.
    var curSet = currentSet.split(",");
    if (curSet.indexOf(buttonId) == -1)
    {
      var set = curSet.concat(buttonId);
      navBar.setAttribute("currentset", set.join(","));
      document.persist("nav-bar", "currentset");

      try { BrowserToolboxCustomizeDone(true); } catch (e) {}
    }

    // Don't forget to show the navigation bar - just in case it's hidden.
    collapse(navBar, false);
    document.persist(navBarId, "collapsed");
  }
  appendToToolbar();
}
WhoIsWatchingHooks();
