var buildRoadsOnPath = function(pos1,pos2,buildRoom){
    path = buildRoom.findPath(pos1,pos2,{ignoreCreeps : true,swampCost : 1});
    for(var i = 0; i < path.length-1; i++){
        buildRoom.createConstructionSite(path[i].x,path[i].y,STRUCTURE_ROAD);
    }
}

var construct = { 
    doit: function(spawn) {
       var extensions = spawn.room.find(FIND_MY_STRUCTURES,{filter:(struct)=>{return struct.structureType === STRUCTURE_EXTENSION}});
       if(extensions.length == 0){
           spawn.room.createConstructionSite(spawn.pos.x + (Math.random()*20) - 10, spawn.pos.y + (Math.random()*20) - 10, STRUCTURE_EXTENSION)
       }
        spawn.room.createConstructionSite(spawn.pos.x + (Math.random()*30) - 15, spawn.pos.y + (Math.random()*30) - 15, STRUCTURE_TOWER)
           for(var i = 0; i < extensions.length; i++){
               buildRoadsOnPath(spawn.pos,extensions[i].pos,spawn.room);
           }
        var sources = spawn.room.find(FIND_SOURCES);
           for(var i = 0; i < sources.length; i++){
               buildRoadsOnPath(spawn.pos,sources[i].pos,spawn.room);
            }
        var minerals = spawn.room.find(FIND_MINERALS);
           for(var i = 0; i < minerals.length; i++){
               buildRoadsOnPath(spawn.pos,minerals[i].pos,spawn.room);
            }
            buildRoadsOnPath(spawn.pos,spawn.room.controller.pos,spawn.room);
            for(var i = 0; i < extensions.length; i++){
               buildRoadsOnPath(spawn.pos,extensions[i].pos,spawn.room);
           }
           for(var m = 0; m < extensions.length; m++){
               var center = extensions[m].pos;
                        var source = false;
                          for(var k = 0; k < sources.length; k++){  
                              if(sources[k].pos.getRangeTo(center) < 3){
                                  source = true;
                              }
                          }
                          if(!source){
                              for(var i = -1; i < 2; i++){
                                for(var j = -1; j < 2; j++){
                                    if(i !== 0 && j !==0){
                                        var roomPos = new RoomPosition(center.x + i, center.y + j, spawn.room.name);
                                        //console.log(roomPos);
                                        if(roomPos.lookFor(LOOK_STRUCTURES).length === 0){
                                            extensions[m].room.createConstructionSite(center.x + i,center.y + j,STRUCTURE_EXTENSION);
                                        }
                                    }
                                }
                              }
                          }
           }
          var exitT = spawn.pos.findClosestByPath(FIND_EXIT_TOP);
          if(exitT !== null){
            buildRoadsOnPath(spawn.pos,exitT,spawn.room);
          }
          var exitB = spawn.pos.findClosestByPath(FIND_EXIT_BOTTOM);
          if(exitB !== null){
            buildRoadsOnPath(spawn.pos,exitB,spawn.room);
          }
          var exitL = spawn.pos.findClosestByPath(FIND_EXIT_LEFT);
          if(exitL !== null){
            buildRoadsOnPath(spawn.pos,exitL,spawn.room);
          }
          var exitR = spawn.pos.findClosestByPath(FIND_EXIT_RIGHT);
          if(exitR !== null){
            buildRoadsOnPath(spawn.pos,exitR,spawn.room);
          }
    }
};

module.exports = construct;