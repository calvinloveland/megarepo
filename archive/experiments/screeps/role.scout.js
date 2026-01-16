var getUnexploredRoom = function(room){
    var got = false;
    var k = 0;
    var newName = ""
    while(!got){
        k++;
        for(var i = -k; i <= k; i++){
            for(var j = -k; j<= k;j++){
                var we = (room.name.search("W") === -1?'E':'W');
                var ns = (room.name.search("N") === -1?'S':'N');
                var x = parseInt(room.name.split(ns)[0].split(we)[1]);
                var y = parseInt(room.name.split(ns)[1]);
                x += i;
                y += j;
                if(x < 0){
                    if(we === "W"){
                        we = "E";
                    }
                    else{
                        we = "W";
                    }
                    x = 0
                }
                if(y < 0){
                    if(we === "S"){
                        we = "N";
                    }
                    else{
                        we = "S";
                    }
                    y = 0;
                }
                if(x <= 60 && y <= 60){
                    var newName = ""+we+x+ns+y;
                    //console.log(newName);
                    if(typeof(Memory.rooms[newName]) === "undefined"){
                        got = true;
                        break;
                    }
                }
            }
            if(got){
                break;
            }
        }
        
    }
    return newName;
}

var roleScout = {

    /** @param {Creep} creep **/
    run: function (creep) {
            if(creep.ticksToLive < 10 && !creep.memory.new){
                Memory.thingsToScout = false;
            }
            if(typeof(creep.memory.goal) === "undefined" || creep.memory.goal === "none"){
                creep.memory.goal = getUnexploredRoom(creep.room);
            }
            if(typeof(creep.room.memory) === "undefined" || !creep.room.memory.explored){
                creep.room.memory.explored = true;
                creep.room.memory.sources = creep.room.find(FIND_SOURCES).length;
                creep.room.memory.hostile = creep.room.find(FIND_HOSTILE_CREEPS).length;
                creep.room.memory.structs = creep.room.find(FIND_STRUCTURES).length;
                creep.memory.new = true;
            }
            if(creep.room.name === creep.memory.goal){
                creep.memory.goal = "none";
            }
            if(typeof(creep.room.controller)!=="undefined" && typeof(creep.room.controller.sign) === "undefined"){
                if(creep.signController(creep.room.controller,"Nivlac13 was here") === ERR_NOT_IN_RANGE){
                 creep.moveTo(creep.room.controller);
                } else{
                creep.memory.new = true;
                }
            }
            else{
                creep.moveTo(new RoomPosition(25,25,creep.memory.goal));
            }
        }
    }

module.exports = roleScout;