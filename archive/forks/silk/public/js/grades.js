let assignments;

import { React, ReactDOM } from 'https://unpkg.com/es-react@16.8.60/index.js';
import htm from 'https://unpkg.com/htm@2.2.1/dist/htm.mjs';
const html = htm.bind(React.createElement);

var title = "All";
function SetTitle(){
  return html`<h1>${title + " Assignments"}</h1>`;
}
function Assignment (props) {
  const assignment = props.assignment;
  return html`
        <div key=${assignment.id}>
              <h5 className="card-title">${assignment.name}</h5>
            <p>${assignment.subject} ${assignment.description} Due: ${assignment.dueDate} </p><p> Grade: ~/10</p>
        </div>
      `;
}

function Assignments (props) {
  return html`
    ${props.assignments.map(function(assignment) {
      return html`<${Assignment} key=${assignment.id} assignment="${assignment}" />`
    })}`;
};

let filteredAssignments;
function ClassDropdown () {
  return html`
            <div class="dropdown-menu" aria-labelledby="navbarDropdown">
              <a class="dropdown-item" href="#" onClick=${(e) => {title="Math", filterSubjects(title)}}>Math</a>
              <a class="dropdown-item" href="#" onClick=${(e) => {title="English", filterSubjects(title)}}>English</a>
              <a class="dropdown-item" href="#" onClick=${(e) => {title="Science", filterSubjects(title)}}>Science</a>
              <div class="dropdown-divider"></div>
              <a class="dropdown-item" href="#" onClick=${(e) => {title="All", filterSubjects('')}}>All</a>
            </div>`;
}

function Search () {
  const [searchTerm, setSearchTerm] = React.useState("");
  return html`
    <form id="search" onSubmit=${(e) => {
    e.preventDefault();
    filterAssignments(searchTerm);
    console.log("other" + searchTerm)
  }} className="form-inline my-2 my-lg-0">
          <input value=${searchTerm} onChange=${(eventData) => setSearchTerm(eventData.target.value)} className="form-control mr-sm-2" type="search" placeholder="Search" aria-label="Search" />
          <button className="btn btn-outline-success my-2 my-sm-0" type="submit">Search</button>
        </form>`;
}

function SubjectFilter () {
  const [searchTerm, setSearchTerm] = React.useState("");
  return html`
    <form id="search" onSubmit=${(e) => {
    e.preventDefault();
    filterSubjects(searchTerm);
    console.log(searchTerm)
  }} className="form-inline my-2 my-lg-0">
          <input value=${searchTerm} onChange=${(eventData) => setSearchTerm(eventData.target.value)} className="form-control mr-sm-2" type="search" placeholder="Search" aria-label="Search" />
          <button className="btn btn-outline-success my-2 my-sm-0" type="submit">Subject Search</button>
        </form>`;
}

// create a copy of assignments;
function filterAssignments (searchTerm) {
  filteredAssignments = assignments.products.filter(assignment => {
    const lowerSearchTerm = searchTerm.toLowerCase();
    return assignment.description.toLowerCase().includes(lowerSearchTerm) ||
      assignment.name.toLowerCase().includes(lowerSearchTerm);
  });
  
  render();
}

function filterSubjects (searchTerm) {
  filteredAssignments = assignments.products.filter(assignment => {
    const lowerSearchTerm = searchTerm.toLowerCase();
    return assignment.subject.toLowerCase().includes(lowerSearchTerm)
  });
  
  render();
}

window.render = function render() {
  const vdom = html`
      <${Assignments} assignments=${filteredAssignments} />
    `;
  console.log("vdom", vdom);
  ReactDOM.render(
    vdom,
    document.getElementById('displayassignmentsdiv')
  );
    ReactDOM.render(
    html`<${SetTitle} />`,
    document.getElementById('title')
  );
    ReactDOM.render(
    html`<${ClassDropdown} />`,
    document.getElementById('classesdropdown')
  );
  ReactDOM.render(
    html`<${Search} />`,
    document.getElementById('search')
  );
}

function turnIn () {
  console.log("turn in assignment ")
}

fetch('/api/products').then(response => {
  if (response.ok) {
      return response.json();
  } else {
      throw Error("Something went wrong with that request:", response.statusText);
  }
}).then(function (data) {
  assignments = data;
  filteredAssignments = assignments.products.slice();
  render();
});
