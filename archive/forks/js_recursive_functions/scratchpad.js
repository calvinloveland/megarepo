

function fibDom(n){
    var result;
    if(n < 2){
        return createSpan("fib("+n+") =" + n,"fibDiv")
    }
    else{
        var newSpan = createSpan("fib("+n+") = " + fib(n) + " =","fibDiv")
        newSpan.appendChild(createDiv("","newline"))
        newSpan.appendChild(fibDom(n-1))
        var secondFib = fibDom(n-2)
        secondFib.innerHTML = " + " + secondFib.innerHTML;
        newSpan.appendChild(secondFib)
        return newSpan
    }
}

function pellDom(n){
    var result;
    if(n < 2){
        return createSpan("pell("+n+") =" + n,"pellDiv")
    }
    else{
        var newSpan = createSpan("pell("+n+") = " + pell(n) + " =","pellDiv")
        newSpan.appendChild(createDiv("","newline"))
        var firstPell = pellDom(n-1)
        firstPell.innerHTML = "2 * " + firstPell.innerHTML;
        newSpan.appendChild(firstPell)
        var secondPell = pellDom(n-2)
        secondPell.innerHTML = " + " + secondPell.innerHTML;
        newSpan.appendChild(secondPell)
        return newSpan
    }
}

function tribDom(n){
    var result;
    if(n < 2){
        return createSpan("trib("+n+") =" + 0,"tribDiv")
    }
    else if(n == 2){
        return createSpan("trib(2) =1","tribDiv")
    }
    else{
        var newSpan = createSpan("trib("+n+") = " + trib(n) + " =","tribDiv")
        newSpan.appendChild(createDiv("","newline"))
        newSpan.appendChild(tribDom(n-1))
        var firstTrib = tribDom(n-2)
        firstTrib.innerHTML = " + " + firstTrib.innerHTML;
        newSpan.appendChild(firstTrib)
        var secondTrib = tribDom(n-3)
        secondTrib.innerHTML = " + " + secondTrib.innerHTML;
        newSpan.appendChild(secondTrib)
        return newSpan
    }
}

function fib(n){
    if(n < 2){
        return  n;
    }
    else{
        return fib(n-1) + fib(n-2);
    }
}

function pell(n){
    if(n<2){
        return n;
    }
    else{
        return 2*pell(n-1) + pell(n-2);
    }
}

function trib(n){
    if(n < 2){
        return 0;
    }
    else if (n == 2){
        return 1;
    }
    else{
        return trib(n-1) + trib(n-2) + trib(n-3);
    }
}

function createDiv(text, className){
    var div = document.createElement("div");
    div.innerHTML = text;
    div.className = className;
    return div;
}

function createSpan(text, className){
    var span = document.createElement("span");
    span.innerHTML = text;
    span.className = className;
    return span;
}

//document.write("Fib(11): " + fib(11) + " Pell(11): " + pell(11)+" Trib(11): "+trib(11));
document.title = "TITLE!";

function fibButton(clicked){
    var parentDiv = clicked.parentNode;
    var fibContainer = fibDom(parentDiv.querySelector("input").value)
    fibContainer.setAttribute("style","width:100%;font-size:100px")
    if(parentDiv.querySelector("span"))
        parentDiv.removeChild(parentDiv.querySelector("span"))
    parentDiv.appendChild(fibContainer)
}

function pellButton(clicked){
    var parentDiv = clicked.parentNode;
    var pellContainer = pellDom(parentDiv.querySelector("input").value)
    pellContainer.setAttribute("style","width:100%;font-size:100px")
    if(parentDiv.querySelector("span"))
        parentDiv.removeChild(parentDiv.querySelector("span"))
    parentDiv.appendChild(pellContainer)
}
function tribButton(clicked){
    var parentDiv = clicked.parentNode;
    var tribContainer = tribDom(parentDiv.querySelector("input").value)
    tribContainer.setAttribute("style","width:100%;font-size:100px")
    if(parentDiv.querySelector("span"))
        parentDiv.removeChild(parentDiv.querySelector("span"))
    parentDiv.appendChild(tribContainer)
}

function updateSlider(changed){
    var parentDiv = changed.parentNode;
    var button = parentDiv.querySelector("button");
    button.innerHTML = button.className + "(" + changed.value + ")";
}

var infoContainer = document.createElement("div")
infoContainer.setAttribute("style","text-align:center;")
var fibInfo = document.createElement("a")
fibInfo.setAttribute("href","https://oeis.org/A000045")
fibInfo.innerHTML = "Fibonacci "
var tribInfo = document.createElement("a")
tribInfo.setAttribute("href","https://oeis.org/A000073")
tribInfo.innerHTML = " Tribonacci "
var pellInfo = document.createElement("a")
pellInfo.setAttribute("href","https://oeis.org/A000129")
pellInfo.innerHTML = " Pell"

infoContainer.appendChild(fibInfo)
infoContainer.appendChild(tribInfo)
infoContainer.appendChild(pellInfo)
document.body.appendChild(infoContainer)