$(document).ready(function() {
  var mainWindow = window.QueryInterface(Components.interfaces.nsIInterfaceRequestor)
                         .getInterface(Components.interfaces.nsIWebNavigation)
                         .QueryInterface(Components.interfaces.nsIDocShellTreeItem)
                         .rootTreeItem
                         .QueryInterface(Components.interfaces.nsIInterfaceRequestor)
                         .getInterface(Components.interfaces.nsIDOMWindow);

  var watchers = mainWindow.gWhoIsWatchingTracker.getTopWatchers();
  if(watchers.length > 0) {
    var summary = [
      {domain:"Any Domain", fraction:mainWindow.gWhoIsWatchingTracker.getFractionWatched()}
    ];
    watchers = summary.concat(watchers);
  } else {
    var summary = [
      {domain:"-- no data --", fraction:0.0}
    ];
    watchers = summary.concat(watchers);
  }
  for(var i = 0; i < watchers.length; ++i) {
    var node = $("#template").clone();
    node.attr("id", "watcher" + i);
    var pct = (watchers[i].fraction * 100) - (watchers[i].fraction * 100) % 1;
    $("img.ico", node)
      .error(function() {$(this).hide();})
      .attr("src", "http://" + watchers[i].domain + "/favicon.ico");
    $("div.bar", node).css("width", "" + pct + "%");
    $("span.dom", node).text(watchers[i].domain);
    $("#template").before(node);
  }
});