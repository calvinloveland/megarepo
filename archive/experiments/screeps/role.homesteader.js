/*
 * Module code goes here. Use 'module.exports' to export things:
 * module.exports.thing = 'a thing';
 *
 * You can import it from another modules like this:
 * var mod = require('role.homesteader');
 * mod.thing == 'a thing'; // true
 */

var roleHomesteader = {

    /** @param {Creep} creep **/
    run: function (creep) {
        var goalFlag = Game.flags.ClaimThis;
        if(typeof(goalFlag) === "undefined"){
            creep.memory.role = "harvester"
        }
        else if(creep.room !== goalFlag.room){
            creep.moveTo(goalFlag.pos);
            creep.say("OFF I GO!")
        }
        else{
            if(typeof(creep.memory.favoriteSource) === "undefined"){
            creep.memory.favoriteSource = 0;
        }
    	    if((creep.carry.energy < creep.carryCapacity && creep.memory.harvesting === true) || creep.carry.energy === 0) {
    	        creep.memory.harvesting = true;
    	        var hostile =  creep.room.find(FIND_STRUCTURES,{filter : (struct)=>{return !struct.my && struct.structureType != STRUCTURE_CONTROLLER}});
    	        if(hostile.length > 0){
    	            var best = creep.pos.findClosestByPath(hostile);
    	            if(creep.dismantle(best) == ERR_NOT_IN_RANGE){
    	                creep.moveTo(best);
    	            }
    	        }
    	        else{
                    var sources = creep.room.find(FIND_SOURCES);
                    if(creep.harvest(sources[creep.memory.favoriteSource]) == ERR_NOT_IN_RANGE) {
                        if(creep.moveTo(sources[creep.memory.favoriteSource])== ERR_NO_PATH){
                            creep.say("NO ROOM");
                            creep.memory.favoriteSource++;
                            if(creep.memory.favoriteSource == sources.length){
                                creep.memory.favoriteSource = 0;
                                creep.memory.role = "none";
                            }
                        }
                    }
    	        }
            }
            else {
            creep.memory.harvesting = false;
                var broken = creep.room.find(FIND_MY_STRUCTURES, {
                        filter: (structure) => {
                            return(((structure.hits < structure.hitsMax * .5 && structure.structureType != STRUCTURE_RAMPART && structure.structureType != STRUCTURE_WALL) || structure.hits < 1000) && (structure.structureType !== STRUCTURE_CONTROLLER));
                        }
                    });
                if ((creep.room.controller.level === 1 || creep.room.controller.ticksToDowngrade < 2000) && creep.upgradeController(creep.room.controller) === ERR_NOT_IN_RANGE) {
                    creep.moveTo(creep.room.controller);
                }
                else if (broken.length > 0) {
                    var best = creep.pos.findClosestByPath(broken)
                    if (creep.repair(best) === ERR_NOT_IN_RANGE) {
                        creep.moveTo(best);
                        
                    }
                }
                else {

                    var targets = creep.room.find(FIND_CONSTRUCTION_SITES,{
                        filter: (cs) => {return cs.my;}
                    });
                    if (targets.length) {
                        if (creep.build(targets[0]) === ERR_NOT_IN_RANGE) {
                            creep.moveTo(targets[0]);
                        }
                    }
                    else {
                        creep.memory.role = "harvester";
                    }
                }
            }
        }
        }
    }
    

module.exports = roleHomesteader;