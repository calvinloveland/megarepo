var last = 0;
var volume = 35;
$("#indicator").text(volume);
$("#volume").height(volume + "%");
window.setInterval(function() {
  if (volume > 0) volume--;
  $("#indicator").text(volume);
  $("#volume").height(volume + "%");
}, 200);
$("#target").draggable({
  drag: function(event, ui) {
    var pos = ui.position.top;
    if (pos > last && volume < 100 && (pos % 2 == 0)) {
      asy("pump_oxygen")
    }
    last = pos;
    console.log(ui.position.top);
    $("#indicator").text(volume);
    $("#volume").height(volume + "%");
  },
  containment: [225, 625, 305, 700],
  axis: "y"
});
