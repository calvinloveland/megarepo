var roleBerserker = {

    /** @param {Creep} creep **/
    run: function (creep) {
            creep.say("SURRENDER", true);
            var hostiles = creep.room.find(FIND_HOSTILE_CREEPS,{filter:(hc)=>{
                return hc.owner.username !== "Source Keeper"}});
            
            if(typeof(Game.flags.Attack) !== "undefined" && creep.room !== Game.flags.Attack.room && hostiles == 0){
                creep.moveTo(Game.flags.Attack.pos);
            }
            else if (typeof(Game.flags.Attack) !== "undefined"  && Game.flags.Attack.setColor !== COLOR_GREEN){
                hostiles.push(... creep.room.find(FIND_STRUCTURES,{filter : (struct)=>{return !struct.my && struct.structureType != STRUCTURE_CONTROLLER}}));
                if(typeof(Game.flags.Attack) !== "undefined" && creep.room === Game.flags.Attack.room  && hostiles.length < 1){
                    Game.flags.Attack.setColor(COLOR_GREEN);
                }
                else {
                    var best = creep.pos.findClosestByPath(hostiles);
                    if(creep.attack(best) === ERR_NOT_IN_RANGE){
                        creep.moveTo(best);
                    }
                }
            }
            else{
                creep.memory.role = "scout";
            }
        }
    }

module.exports = roleBerserker;