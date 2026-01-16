var getRoom = function(room,direction){
                var we = (room.name.search("W") === -1?'E':'W');
                var ns = (room.name.search("N") === -1?'S':'N');
                var x = parseInt(room.name.split(ns)[0].split(we)[1]);
                var y = parseInt(room.name.split(ns)[1]);
            if(direction === "left"){
                x++;
            }
            if(direction === "right"){
                x--;
            }
            if(direction === "down"){
                y--;
            }
            if(direction === "up"){
                y++;
            }
            return new RoomPosition(25,25,""+we+x+ns+y);
}

module.exports = getRoom;