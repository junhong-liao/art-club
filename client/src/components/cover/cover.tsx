import React from 'react';
import LoginButtons from '../signin/loginbuttons';
import './cover.scss';

function Cover() {
  return (
    <div id="cover">
      <div id="logincard">
        <div>
          <div id="logo"><i className="fa fa-pinterest" aria-hidden="true" /></div>
          <div id="welcome">Welcome to ArtClub</div>
          <div id="subheader">Find inspiration and share your art</div>
          <div id="disclaimer">Currently under development...</div>
          <div id="gitsource">
            <a href="https://github.com/Dereje1/Pinterest-Clone" target="_blank" rel="noopener noreferrer">
              <i className="fa fa-github" aria-hidden="true" />
              {' Github'}
            </a>
          </div>
        </div>
        <div>
          <LoginButtons guest={() => ({})} />
        </div>
      </div>
    </div>
  );
}

export default Cover;
