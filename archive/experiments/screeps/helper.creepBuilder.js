var aps = ["Peter","Andrew","Judas","John","Matias","Levi","Mathew"]

var getNumGather = function(room) {
    var resources = room.find(FIND_SOURCES_ACTIVE);
    var valid_spots = 0;
    for(var index in resources){
        var center = resources[index].pos;
        for(var i = -1; i < 2; i++){
            for(var j = -1; j < 2; j++){
            if(Game.map.getRoomTerrain(room.name).get(center.x + i, center.y + j) != 'wall' && !RoomPosition(center.x + i, center.y + j, room.name).lookFor(LOOK_CREEPS).length){
                valid_spots++;
            }
            }
            
        }
    }
    return valid_spots;
};




var creepBuilder = { 
    
    doit: function(spawn) {
        
        
        
        var hostiles = spawn.room.find(FIND_HOSTILE_CREEPS);
        var totalCreeps = spawn.room.find(FIND_MY_CREEPS).length;
        spawn.room.memory.creepCount = totalCreeps;
         if(totalCreeps === 0 ){
             console.log("Reviving");
            spawn.createCreep([WORK,CARRY,MOVE],Math.floor(Math.random()*10) + "-JESUS THE FIRST BORN SON of" + spawn.name, {role:"Jesus"})
        }
        else if(totalCreeps <  5){
             console.log("Creating Apostles");
            spawn.createCreep([WORK,CARRY,MOVE],Math.floor(Math.random()*10) + "Apostle " + aps[totalCreeps-1] + " of " + spawn.name, {role:"harvester"})
        }
        else  if(typeof(Game.flags.Attack) !== "undefined" && Game.flags.Attack.color === COLOR_RED && totalCreeps >= 8  && spawn.room.energyAvailable > 130){
            spawn.createCreep([ATTACK,MOVE],undefined,{role:"berserker"});
        }
        else if(hostiles.length > 0 && spawn.room.energyAvailable > 130) {
            spawn.createCreep([ATTACK,MOVE],undefined,{role:"berserker"});
        }
        else if(typeof(Game.flags.ClaimThis) !== "undefined" && Game.flags.ClaimThis.color == COLOR_BLUE && totalCreeps > 5){
            if(spawn.room.energyAvailable >= 200){
                spawn.createCreep([WORK,CARRY,MOVE],undefined,{role:"homesteader"})
            }
        }
        else if(typeof(Game.flags.ClaimThis) !== "undefined" 
        && Game.flags.ClaimThis.color == COLOR_GREEN 
        && totalCreeps > 5 
        && spawn.room.energyCapacityAvailable >= 700
        ){
            spawn.createCreep([CLAIM,MOVE,MOVE],undefined,{role:"claimer"})
        }
        else if(totalCreeps < 50 && spawn.room.energyAvailable > spawn.room.energyCapacityAvailable * .8){
                if(spawn.room.energyAvailable >= 2400){
                    spawn.createCreep([WORK,WORK,WORK,WORK,WORK,WORK,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,WORK,WORK,WORK,WORK,WORK,WORK,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE],undefined,{role:"none"});
                }
                if(spawn.room.energyAvailable >= 1200){
                    spawn.createCreep([WORK,WORK,WORK,WORK,WORK,WORK,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE],undefined,{role:"none"});
                }
                else if(spawn.room.energyAvailable >= 750){
                    spawn.createCreep([WORK,WORK,WORK,WORK,CARRY,CARRY,CARRY,MOVE,MOVE,MOVE,MOVE],undefined,{role:"none"});
                }
                else if(spawn.room.energyAvailable >= 550){
                    spawn.createCreep([WORK,WORK,WORK,WORK,CARRY,MOVE,MOVE],undefined,{role:"none"});
                }
                else if(spawn.room.energyAvailable >= 450){
                    spawn.createCreep([WORK,WORK,WORK,CARRY,MOVE,MOVE],undefined,{role:"none"});
                }
                else if(spawn.room.energyAvailable >= 200){
                    spawn.createCreep([WORK,CARRY,MOVE],undefined,{role:"none"});
                }
        }
        else if(!Memory.scouting && Memory.thingsToScout && spawn.room.energyAvailable > 50){
            spawn.createCreep([MOVE],"Scout Curly",{role:"scout",new:false});
            Memory.scouting = true;
        }
    }
};

module.exports = creepBuilder;