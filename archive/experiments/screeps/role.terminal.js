

var roleTerminal = {

    /** @param {StructureTerminal} terminal **/
    run: function (terminal) {
        var energy = terminal.store[RESOURCE_ENERGY];
        for(var resource in terminal.store){
            amount = terminal.store[resource];
            if(resource !== RESOURCE_ENERGY && amount > 500){
                var best = "0";
                var bestNum = 0;
                var orders = Game.market.getAllOrders({type:ORDER_BUY, resourceType:resource});
                for(var order in orders){
                    order = orders[order];
                    if(resource === order.resourceType && order.type === "buy" && order.remainingAmount > amount){
                        cost = Game.market.calcTransactionCost(amount,terminal.room.name,order.roomName);
                        price = order.price * amount;
                        if(price/cost > bestNum){
                            bestNum = price/cost;
                            best = order.id;
                            
                        }
                        
                    }
                }
                if(best !== "0"){
                   console.log("Sold stuff: "  + Game.market.deal(best,amount,terminal.room.name));
                }
            }
            
        }
       
    }
}

module.exports = roleTerminal;