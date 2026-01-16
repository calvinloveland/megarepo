var findSource = require("helper.findSource");
var findRoom = require("functions.rooms");
var roleHarvester = require("role.harvester");

var roleRemoteHarvester = {

    /** @param {Creep} creep **/
    run: function(creep) {
        if(typeof(creep.memory.home) === "undefined"){
            creep.memory.home = creep.room;
        }
        
	    if((creep.carry.energy < creep.carryCapacity && creep.memory.harvesting === true) || creep.carry.energy === 0) {
	        creep.memory.harvesting = true;
	        if(typeof(creep.room.controller) === "undefined" || !creep.room.controller.my){
	             roleHarvester.run(creep);
	        }
            else{
               if(typeof(creep.memory.otherRoom) === "undefined"  || creep.memory.otherRoom === "none"){
                   var num = Math.random();
                   if(num < .25){
                       creep.memory.otherRoom = "left"
                   }
                   else if(num < .5){
                       creep.memory.otherRoom = "right"
                   }
                   else if(num < .75){
                       creep.memory.otherRoom = "up"
                   }
                   else {
                       creep.memory.otherRoom = "down"
                   }
               }
               otherRoom = findRoom(creep.room,creep.memory.otherRoom);
               creep.say(otherRoom)
               if(creep.moveTo(otherRoom) === ERR_NO_PATH){
                   creep.say("NoPath" + creep.memory.otherRoom);
                   creep.memory.otherRoom = "none";
               }
            }
        }
        else {
            creep.memory.harvesting = false;
            if(typeof(creep.room.controller) === "undefined" || !creep.room.controller.my){
               creep.moveTo(new RoomPosition(25,25,creep.memory.home.name));
	        }
	        else{
	            //creep.say("Home sweet home")
	            //creep.moveTo(creep.room.controller.pos)
                roleHarvester.run(creep);
	        }
        }
	}
};

module.exports = roleRemoteHarvester;